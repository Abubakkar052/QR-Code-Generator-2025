/**
 * QR Code Generator Application
 * A modern, accessible QR code generator built with vanilla HTML, CSS, and JavaScript
 */
(function() {
    'use strict';

    // Constants
    const DEFAULTS = {
        size: 320,
        margin: 4,
        ecc: 'M',
        fgColor: '#111111',
        bgColor: '#ffffff',
        bgTransparent: false,
        pictureSize: 35
    };

    const SIZE_LIMITS = {
        min: 128,
        max: 1024,
        step: 16
    };

    // Largest still-scannable logo size (% of QR) per error-correction level.
    // `good` = comfortably scannable, `risky` = scannable but tight, above `risky` = likely fails.
    const SCANNABILITY = {
        L: { good: 15, risky: 20 },
        M: { good: 24, risky: 30 },
        Q: { good: 33, risky: 42 },
        H: { good: 42, risky: 52 }
    };

    // Uploaded images larger than this max edge (px) are downscaled before
    // embedding. Kept high so logos stay sharp when the QR is downloaded/zoomed;
    // smaller logos pass through at full resolution (we never upscale).
    const MAX_IMAGE_DIMENSION = 1024;

    /**
     * Registry of additional QR content types. Each type is pure data: the
     * fields to render, a build() that turns field values into the standard
     * encoded string, an info() summary, and a hint. New types are added here
     * without touching the existing 4 hard-coded types' code paths.
     */
    const QR_TYPES = {
        email: {
            label: 'Email',
            fields: [
                { id: 'to', label: 'Email Address', type: 'email', required: true, placeholder: 'name@example.com' },
                { id: 'subject', label: 'Subject', type: 'text', placeholder: 'Subject (optional)' },
                { id: 'body', label: 'Message', type: 'textarea', placeholder: 'Message (optional)' }
            ],
            build: v => `mailto:${v.to}?subject=${encodeURIComponent(v.subject || '')}&body=${encodeURIComponent(v.body || '')}`,
            info: v => `Email: ${v.to}`,
            hint: 'Opens the email app on the scanning phone with your message pre-filled.'
        },
        sms: {
            label: 'SMS',
            fields: [
                { id: 'number', label: 'Phone Number', type: 'tel', required: true, placeholder: '+1234567890' },
                { id: 'message', label: 'Message', type: 'textarea', placeholder: 'Message (optional)' }
            ],
            build: v => `SMSTO:${v.number}:${v.message || ''}`,
            info: v => `SMS to: ${v.number}`,
            hint: 'Opens the messaging app with the number and text ready to send.'
        },
        phone: {
            label: 'Phone Call',
            fields: [
                { id: 'number', label: 'Phone Number', type: 'tel', required: true, placeholder: '+1234567890' }
            ],
            build: v => `tel:${v.number}`,
            info: v => `Call: ${v.number}`,
            hint: 'Opens the dialer with the number ready to call.'
        },
        whatsapp: {
            label: 'WhatsApp',
            fields: [
                { id: 'number', label: 'Phone Number (with country code)', type: 'tel', required: true, placeholder: '+1234567890' },
                { id: 'message', label: 'Pre-filled Message', type: 'textarea', placeholder: 'Message (optional)' }
            ],
            build: v => {
                const num = (v.number || '').replace(/[^\d]/g, '');
                const text = v.message ? `?text=${encodeURIComponent(v.message)}` : '';
                return `https://wa.me/${num}${text}`;
            },
            info: v => `WhatsApp: ${v.number}`,
            hint: 'Opens a WhatsApp chat with the message pre-filled.'
        },
        geo: {
            label: 'Geo Location',
            fields: [
                { id: 'lat', label: 'Latitude', type: 'number', required: true, placeholder: 'e.g. 37.7749' },
                { id: 'lng', label: 'Longitude', type: 'number', required: true, placeholder: 'e.g. -122.4194' },
                { id: 'label', label: 'Label', type: 'text', placeholder: 'Place name (optional)' }
            ],
            build: v => {
                const base = `geo:${v.lat},${v.lng}`;
                return v.label ? `${base}?q=${v.lat},${v.lng}(${encodeURIComponent(v.label)})` : base;
            },
            info: v => `Location: ${v.lat}, ${v.lng}`,
            hint: 'Opens the maps app at the given coordinates.'
        },
        event: {
            label: 'Calendar Event',
            fields: [
                { id: 'title', label: 'Event Title', type: 'text', required: true, placeholder: 'Team meeting' },
                { id: 'location', label: 'Location', type: 'text', placeholder: 'Location (optional)' },
                { id: 'start', label: 'Start', type: 'datetime-local', required: true },
                { id: 'end', label: 'End', type: 'datetime-local', required: true },
                { id: 'description', label: 'Description', type: 'textarea', placeholder: 'Details (optional)' }
            ],
            build: v => {
                // 'YYYY-MM-DDTHH:MM' -> 'YYYYMMDDTHHMMSS' (floating local time)
                const fmt = s => s ? s.replace(/[-:]/g, '').replace(/(\d{8}T\d{4})$/, '$100') : '';
                let s = 'BEGIN:VEVENT\n';
                s += `SUMMARY:${v.title}\n`;
                if (v.location) s += `LOCATION:${v.location}\n`;
                if (v.description) s += `DESCRIPTION:${v.description}\n`;
                if (v.start) s += `DTSTART:${fmt(v.start)}\n`;
                if (v.end) s += `DTEND:${fmt(v.end)}\n`;
                s += 'END:VEVENT';
                return s;
            },
            info: v => `Event: ${v.title}`,
            hint: 'Adds an event to the calendar when scanned. Times use the scanner’s local time zone.'
        },
        paypal: {
            label: 'PayPal',
            fields: [
                { id: 'handle', label: 'PayPal.Me Username', type: 'text', required: true, placeholder: 'yourname' },
                { id: 'amount', label: 'Amount', type: 'number', placeholder: 'e.g. 10.00 (optional)' }
            ],
            build: v => {
                const handle = (v.handle || '').replace(/^@/, '').trim();
                const base = `https://www.paypal.com/paypalme/${encodeURIComponent(handle)}`;
                return v.amount ? `${base}/${encodeURIComponent(v.amount)}` : base;
            },
            info: v => `PayPal: @${(v.handle || '').replace(/^@/, '')}`,
            hint: 'Opens your PayPal.Me page. Create a free handle at paypal.me first — no fees to generate this.'
        },
        upi: {
            label: 'UPI Payment',
            fields: [
                { id: 'vpa', label: 'UPI ID (VPA)', type: 'text', required: true, placeholder: 'name@bank' },
                { id: 'name', label: 'Payee Name', type: 'text', placeholder: 'Name (optional)' },
                { id: 'amount', label: 'Amount (INR)', type: 'number', placeholder: 'e.g. 100 (optional)' }
            ],
            build: v => {
                let s = `upi://pay?pa=${encodeURIComponent(v.vpa)}`;
                if (v.name) s += `&pn=${encodeURIComponent(v.name)}`;
                if (v.amount) s += `&am=${encodeURIComponent(v.amount)}`;
                s += '&cu=INR';
                return s;
            },
            info: v => `UPI: ${v.vpa}`,
            hint: 'Opens a UPI app (GPay, PhonePe, etc.) to pay. Requires a UPI app installed (India).'
        },
        crypto: {
            label: 'Crypto Wallet',
            fields: [
                { id: 'scheme', label: 'Currency', type: 'select', required: true, options: [
                    { value: 'bitcoin', label: 'Bitcoin (BTC)' },
                    { value: 'ethereum', label: 'Ethereum (ETH)' },
                    { value: 'litecoin', label: 'Litecoin (LTC)' }
                ] },
                { id: 'address', label: 'Wallet Address', type: 'text', required: true, placeholder: 'Your wallet address' },
                { id: 'amount', label: 'Amount', type: 'number', placeholder: 'Amount (optional)' }
            ],
            build: v => {
                const base = `${v.scheme}:${v.address}`;
                return v.amount ? `${base}?amount=${encodeURIComponent(v.amount)}` : base;
            },
            info: v => `${v.scheme}: ${(v.address || '').slice(0, 16)}…`,
            hint: 'Opens a compatible crypto wallet with the address (and amount) pre-filled.'
        }
    };

    const MARGIN_LIMITS = {
        min: 0,
        max: 64
    };


    const DEBOUNCE_DELAY = 300;

    // DOM Elements
    const elements = {
        // Form elements
        form: document.getElementById('qr-form'),
        typeSelect: document.getElementById('qr-type'),
        textInput: document.getElementById('qr-text'),
        sizeInput: document.getElementById('qr-size'),

        // WiFi elements
        wifiSsidInput: document.getElementById('wifi-ssid'),
        wifiPasswordInput: document.getElementById('wifi-password'),
        wifiEncryptionSelect: document.getElementById('wifi-encryption'),
        wifiHiddenCheckbox: document.getElementById('wifi-hidden'),
        togglePasswordBtn: document.getElementById('toggle-password'),

        // Contact elements
        contactFirstNameInput: document.getElementById('contact-first-name'),
        contactLastNameInput: document.getElementById('contact-last-name'),
        contactPhoneInput: document.getElementById('contact-phone'),
        contactEmailInput: document.getElementById('contact-email'),
        contactCompanyInput: document.getElementById('contact-company'),
        contactJobTitleInput: document.getElementById('contact-job-title'),
        contactWebsiteInput: document.getElementById('contact-website'),
        contactAddressInput: document.getElementById('contact-address'),

        // Input sections
        textInputSection: document.getElementById('text-input-section'),
        wifiInputSection: document.getElementById('wifi-input-section'),
        passwordFieldContainer: document.getElementById('password-field-container'),
        contactInputSection: document.getElementById('contact-input-section'),
        pictureInputSection: document.getElementById('picture-input-section'),
        dynamicInputSection: document.getElementById('dynamic-input-section'),
        dynamicFields: document.getElementById('dynamic-fields'),
        dynamicTypeHint: document.getElementById('dynamic-type-hint'),

        // Picture QR code elements
        pictureTextInput: document.getElementById('picture-text'),
        pictureUploadInput: document.getElementById('picture-upload'),
        picturePreview: document.getElementById('picture-preview'),
        pictureSizeInput: document.getElementById('picture-size'),
        pictureSizeValue: document.getElementById('picture-size-value'),
        pictureCropCheckbox: document.getElementById('picture-crop-square'),
        scannability: document.getElementById('picture-scannability'),

        eccSelect: document.getElementById('qr-ecc'),
        marginInput: document.getElementById('qr-margin'),
        fgColorInput: document.getElementById('qr-fg-color'),
        bgColorInput: document.getElementById('qr-bg-color'),
        bgTransparentCheckbox: document.getElementById('qr-bg-transparent'),

        // Style & branding controls
        dotStyleSelect: document.getElementById('qr-dot-style'),
        cornerSquareStyleSelect: document.getElementById('qr-corner-square-style'),
        cornerDotStyleSelect: document.getElementById('qr-corner-dot-style'),
        cornerColorInput: document.getElementById('qr-corner-color'),
        cornerMatchCheckbox: document.getElementById('qr-corner-match'),
        gradientEnabledCheckbox: document.getElementById('qr-gradient-enabled'),
        gradientColorInput: document.getElementById('qr-gradient-color'),
        gradientTypeSelect: document.getElementById('qr-gradient-type'),

        generateBtn: document.getElementById('generate-btn'),
        resetBtn: document.getElementById('reset-btn'),

        // Preview elements
        preview: document.getElementById('qr-preview'),
        info: document.getElementById('qr-info'),

        // Full-size preview modal
        qrModal: document.getElementById('qr-modal'),
        qrModalBody: document.getElementById('qr-modal-body'),
        qrModalClose: document.getElementById('qr-modal-close'),
        modalDownloadBtn: document.getElementById('modal-download-btn'),
        modalCopyBtn: document.getElementById('modal-copy-btn'),

        // Frame controls
        frameEnabledCheckbox: document.getElementById('qr-frame-enabled'),
        frameTextInput: document.getElementById('qr-frame-text'),
        frameColorInput: document.getElementById('qr-frame-color'),
        framePositionSelect: document.getElementById('qr-frame-position'),

        // Download / export elements
        exportFormatSelect: document.getElementById('export-format'),
        exportResolutionSelect: document.getElementById('export-resolution'),
        downloadBtn: document.getElementById('download-btn'),
        copyClipboardBtn: document.getElementById('copy-clipboard'),

        // Other elements
        themeToggle: document.getElementById('theme-toggle'),
        themeIcon: document.querySelector('.theme-icon'),
        textHint: document.getElementById('text-hint')
    };

    // State
    let qrCode = null;
    let debounceTimer = null;
    let isGenerating = false;
    let userInteracted = {
        size: false,
        margin: false,
        text: false,
        wifi: false,
        contact: false,
        picture: false,
        dynamic: false
    };

    // Picture QR code state
    let uploadedImage = null;
    let imageDataUrl = null;        // processed image actually embedded in the QR
    let originalImageDataUrl = null; // raw upload, kept so we can re-process on settings change

    // The data string currently rendered — used by export/frame so non-text
    // types (WiFi, vCard, Email, …) export with the correct content.
    let currentData = '';
    // Token to drop stale async frame-preview renders
    let framePreviewToken = 0;

    /**
     * Remove required attribute from hidden form controls
     */
    function removeRequiredFromHiddenInputs() {
        // Remove required from all input sections that are hidden by default
        elements.textInput.removeAttribute('required');
        elements.wifiSsidInput.removeAttribute('required');
        elements.contactFirstNameInput.removeAttribute('required');
        elements.pictureTextInput.removeAttribute('required');
    }

    /**
     * Initialize the application
     */
    function init() {
        initializeQrCode();
        setupEventListeners();
        setupKeyboardShortcuts();
        loadThemePreference();
        setupFormSync();

        // Ensure no hidden form controls have required attribute on initial load
        removeRequiredFromHiddenInputs();

        // Initial state - only update button, don't show validation errors
        updateGenerateButton();
    }

    /**
     * Initialize QR Code Styling library
     */
    function initializeQrCode() {
        try {
            qrCode = new QRCodeStyling({
                width: DEFAULTS.size,
                height: DEFAULTS.size,
                type: 'svg',
                data: '',
                margin: DEFAULTS.margin,
                qrOptions: {
                    typeNumber: 0,
                    mode: 'Byte',
                    errorCorrectionLevel: DEFAULTS.ecc
                },
                dotsOptions: {
                    color: DEFAULTS.fgColor,
                    type: 'rounded'
                },
                backgroundOptions: {
                    color: DEFAULTS.bgColor
                },
                imageOptions: {
                    crossOrigin: 'anonymous',
                    margin: 20,
                    hideBackgroundDots: true,
                    imageSize: 0.5
                }
            });
        } catch (error) {
            console.error('Failed to initialize QR Code library:', error);
            showError('Failed to initialize QR code generator. Please refresh the page.');
        }
    }

    /**
     * Set up all event listeners
     */
    function setupEventListeners() {
        // Form submission
        elements.form.addEventListener('submit', handleGenerate);

        // Form inputs
        elements.typeSelect.addEventListener('change', handleTypeChange);
        elements.textInput.addEventListener('input', handleTextInput);
        elements.sizeInput.addEventListener('input', handleSizeChange);
        elements.marginInput.addEventListener('input', handleMarginChange);
        elements.fgColorInput.addEventListener('input', handleColorChange);
        elements.bgColorInput.addEventListener('input', handleColorChange);
        elements.bgTransparentCheckbox.addEventListener('change', handleTransparentChange);

        // Style & branding controls
        elements.dotStyleSelect.addEventListener('change', liveRefresh);
        elements.cornerSquareStyleSelect.addEventListener('change', liveRefresh);
        elements.cornerDotStyleSelect.addEventListener('change', liveRefresh);
        elements.cornerColorInput.addEventListener('input', liveRefresh);
        elements.cornerMatchCheckbox.addEventListener('change', handleCornerMatchChange);
        elements.gradientEnabledCheckbox.addEventListener('change', handleGradientToggle);
        elements.gradientColorInput.addEventListener('input', liveRefresh);
        elements.gradientTypeSelect.addEventListener('change', liveRefresh);

        // WiFi inputs
        elements.wifiSsidInput.addEventListener('input', handleWifiInput);
        elements.wifiPasswordInput.addEventListener('input', handleWifiInput);
        elements.wifiEncryptionSelect.addEventListener('change', handleWifiInput);
        elements.wifiHiddenCheckbox.addEventListener('change', handleWifiInput);
        elements.togglePasswordBtn.addEventListener('click', togglePasswordVisibility);

        // Contact inputs
        elements.contactFirstNameInput.addEventListener('input', handleContactInput);
        elements.contactLastNameInput.addEventListener('input', handleContactInput);
        elements.contactPhoneInput.addEventListener('input', handleContactInput);
        elements.contactEmailInput.addEventListener('input', handleContactInput);
        elements.contactCompanyInput.addEventListener('input', handleContactInput);
        elements.contactJobTitleInput.addEventListener('input', handleContactInput);
        elements.contactWebsiteInput.addEventListener('input', handleContactInput);
        elements.contactAddressInput.addEventListener('input', handleContactInput);

        // Picture QR code inputs
        elements.pictureTextInput.addEventListener('input', handlePictureInput);
        elements.pictureUploadInput.addEventListener('change', handleImageUpload);
        elements.pictureSizeInput.addEventListener('input', handlePictureSettingsChange);
        elements.pictureCropCheckbox.addEventListener('change', handleCropChange);
        elements.eccSelect.addEventListener('change', handleEccChange);

        // Setup drag and drop for image upload
        setupImageDragAndDrop();

        // Frame controls
        elements.frameEnabledCheckbox.addEventListener('change', handleFrameToggle);
        elements.frameTextInput.addEventListener('input', liveRefresh);
        elements.frameColorInput.addEventListener('input', liveRefresh);
        elements.framePositionSelect.addEventListener('change', liveRefresh);

        // Full-size preview modal
        elements.preview.addEventListener('click', openQrModal);
        elements.qrModalClose.addEventListener('click', closeQrModal);
        elements.qrModal.addEventListener('click', (e) => {
            if (e.target.hasAttribute('data-close')) closeQrModal();
        });
        elements.modalDownloadBtn.addEventListener('click', () => downloadQR());
        elements.modalCopyBtn.addEventListener('click', copyToClipboard);

        // Buttons
        elements.resetBtn.addEventListener('click', handleReset);
        elements.downloadBtn.addEventListener('click', () => downloadQR());
        elements.copyClipboardBtn.addEventListener('click', copyToClipboard);
        elements.themeToggle.addEventListener('click', toggleTheme);

        // WhatsApp toggle
        const whatsappToggle = document.getElementById('whatsapp-toggle');
        whatsappToggle.addEventListener('click', () => {
            const phoneNumber = '+923142979757';
            const message = 'Hello! I would like to discuss about your QR Code Generator project.';
            const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank');
        });

        // Navigation
        const navToggle = document.getElementById('nav-toggle');
        const navMenu = document.getElementById('nav-menu');
        const navLinks = document.querySelectorAll('.nav-link');

        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            navToggle.classList.toggle('active');
        });

        // Close mobile menu when clicking on a link
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href').substring(1);
                const targetSection = document.getElementById(targetId);
                
                if (targetSection) {
                    targetSection.scrollIntoView({ 
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
                
                // Update active state immediately
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                
                navMenu.classList.remove('active');
                navToggle.classList.remove('active');
            });
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!navToggle.contains(e.target) && !navMenu.contains(e.target)) {
                navMenu.classList.remove('active');
                navToggle.classList.remove('active');
            }
        });

        // Add scroll spy functionality
        setupScrollSpy();


    }

    /**
     * Set up keyboard shortcuts
     */
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Enter to generate
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!elements.generateBtn.disabled) {
                    handleGenerate(e);
                }
            }

            // Escape to close the modal (or clear focus)
            if (e.key === 'Escape') {
                if (elements.qrModal && !elements.qrModal.hidden) {
                    closeQrModal();
                    return;
                }
                const activeElement = document.activeElement;
                if (activeElement && activeElement.blur) {
                    activeElement.blur();
                }
            }
        });
    }

    /**
     * Setup form synchronization (placeholder for future features)
     */
    function setupFormSync() {
        // Form sync functionality removed with size slider
    }

    /**
     * Setup scroll spy to highlight active section in navbar
     */
    function setupScrollSpy() {
        const sections = ['generator', 'preview'];
        const navLinks = document.querySelectorAll('.nav-link');
        
        function updateActiveSection() {
            const scrollPosition = window.scrollY + 100; // Offset for navbar height
            
            sections.forEach((sectionId, index) => {
                const section = document.getElementById(sectionId);
                if (!section) return;
                
                const sectionTop = section.offsetTop;
                const sectionBottom = sectionTop + section.offsetHeight;
                
                if (scrollPosition >= sectionTop && scrollPosition < sectionBottom) {
                    // Remove active class from all links
                    navLinks.forEach(link => link.classList.remove('active'));
                    // Add active class to current section link
                    navLinks[index].classList.add('active');
                }
            });
        }
        
        // Update on scroll
        window.addEventListener('scroll', updateActiveSection);
        
        // Initial update
        updateActiveSection();
        
        // Set Generate section as active by default
        navLinks[0].classList.add('active');
    }

        /**
     * Handle text input with debounced validation
     */
    function handleTextInput() {
        userInteracted.text = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updateFormValidation();
            updateGenerateButton();
            detectUrl();
        }, DEBOUNCE_DELAY);
    }

    /**
     * Handle size change
     */
    function handleSizeChange() {
        userInteracted.size = true;
        const size = parseInt(elements.sizeInput.value);
        if (size >= SIZE_LIMITS.min && size <= SIZE_LIMITS.max) {
            // Validate size within limits
            elements.sizeInput.value = size;
        }
        updateFormValidation();
        updateGenerateButton();
    }

    /**
     * Handle margin change
     */
    function handleMarginChange() {
        userInteracted.margin = true;
        const margin = parseInt(elements.marginInput.value);
        if (margin < MARGIN_LIMITS.min) {
            elements.marginInput.value = MARGIN_LIMITS.min;
        } else if (margin > MARGIN_LIMITS.max) {
            elements.marginInput.value = MARGIN_LIMITS.max;
        }
        updateFormValidation();
        updateGenerateButton();
    }

    /**
     * Handle color changes
     */
    function handleColorChange() {
        liveRefresh();
    }

    /**
     * Handle transparent background toggle
     */
    function handleTransparentChange() {
        elements.bgColorInput.disabled = elements.bgTransparentCheckbox.checked;
        handleColorChange();
    }

    /**
     * Resolve an "Auto" corner style to a concrete value based on the dot style,
     * mirroring the natural pairing the library would otherwise pick.
     */
    function autoCornerStyle(dotStyle, kind) {
        const rounded = dotStyle === 'dots' || dotStyle === 'rounded' ||
                        dotStyle === 'classy-rounded' || dotStyle === 'extra-rounded';
        if (kind === 'dot') return rounded ? 'dot' : 'square';
        return rounded ? 'extra-rounded' : 'square'; // corner square frame
    }

    /**
     * Enable/disable the corner color picker based on the "match foreground" box
     */
    function handleCornerMatchChange() {
        elements.cornerColorInput.disabled = elements.cornerMatchCheckbox.checked;
        liveRefresh();
    }

    /**
     * Enable/disable the gradient color + direction based on the gradient toggle
     */
    function handleGradientToggle() {
        const on = elements.gradientEnabledCheckbox.checked;
        elements.gradientColorInput.disabled = !on;
        elements.gradientTypeSelect.disabled = !on;
        liveRefresh();
    }

    /**
     * Re-render the current QR (using the active type's data) when styling
     * changes — but only if a code has already been generated. Reuses the pure
     * string builders so non-text types update correctly too.
     */
    function liveRefresh() {
        if (!qrCode) return;
        const hasQR = elements.preview.querySelector('svg') ||
                      elements.preview.querySelector('canvas');
        if (!hasQR) return;

        const type = elements.typeSelect.value;
        if (type === 'wifi') {
            if (!elements.wifiSsidInput.value.trim()) return;
            updateQrCodeWithData(generateWifiString(
                elements.wifiSsidInput.value.trim(),
                elements.wifiPasswordInput.value,
                elements.wifiEncryptionSelect.value,
                elements.wifiHiddenCheckbox.checked
            ));
        } else if (type === 'contact') {
            if (!elements.contactFirstNameInput.value.trim()) return;
            updateQrCodeWithData(generateVCardString(
                elements.contactFirstNameInput.value.trim(),
                elements.contactLastNameInput.value.trim(),
                elements.contactPhoneInput.value.trim(),
                elements.contactEmailInput.value.trim(),
                elements.contactCompanyInput.value.trim(),
                elements.contactJobTitleInput.value.trim(),
                elements.contactWebsiteInput.value.trim(),
                elements.contactAddressInput.value.trim()
            ));
        } else if (type === 'picture') {
            if (elements.pictureTextInput.value.trim() && uploadedImage) {
                updateQrCode();
            }
        } else if (QR_TYPES[type]) {
            if (registryHasContent(type)) {
                updateQrCodeWithData(QR_TYPES[type].build(getRegistryValues()));
            }
        } else {
            if (elements.textInput.value.trim()) {
                updateQrCode();
            }
        }
    }

    /**
     * Handle QR code type change
     */
    function handleTypeChange() {
        const type = elements.typeSelect.value;
        
        // Reset form when type changes
        resetFormOnTypeChange();
        
        // Hide all sections first
        elements.textInputSection.style.display = 'none';
        elements.wifiInputSection.style.display = 'none';
        elements.contactInputSection.style.display = 'none';
        elements.pictureInputSection.style.display = 'none';
        elements.dynamicInputSection.style.display = 'none';

        // Remove required attributes
        elements.textInput.removeAttribute('required');
        elements.wifiSsidInput.removeAttribute('required');
        elements.contactFirstNameInput.removeAttribute('required');
        elements.pictureTextInput.removeAttribute('required');

        if (type === 'wifi') {
            elements.wifiInputSection.style.display = 'block';
            elements.wifiSsidInput.setAttribute('required', '');
            
            // Initialize password field visibility
            updatePasswordFieldVisibility();
            
            // Hide hint for other types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        } else if (type === 'contact') {
            elements.contactInputSection.style.display = 'block';
            elements.contactFirstNameInput.setAttribute('required', '');
            
            // Hide hint for other types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        } else if (type === 'picture') {
            elements.pictureInputSection.style.display = 'block';
            elements.pictureTextInput.setAttribute('required', '');
            
            // Set error correction to High for picture QR codes
            elements.eccSelect.value = 'H';
            
            // Show hint about error correction
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'block';
                eccHint.style.color = 'var(--color-primary)';
                eccHint.style.fontWeight = '600';
            }
        } else if (QR_TYPES[type]) {
            elements.dynamicInputSection.style.display = 'block';
            renderRegistrySection(type);

            // Hide ECC hint for these types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        } else {
            // Text/URL type
            elements.textInputSection.style.display = 'block';
            elements.textInput.setAttribute('required', '');

            // Hide hint for other types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        }

        updateFormValidation();
        updateGenerateButton();
    }

    /**
     * Handle WiFi input changes
     */
    function handleWifiInput() {
        userInteracted.wifi = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updatePasswordFieldVisibility();
            updateFormValidation();
            updateGenerateButton();
            validateWifiSettings();
        }, DEBOUNCE_DELAY);
    }

    /**
     * Handle contact input changes
     */
    function handleContactInput() {
        userInteracted.contact = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updateFormValidation();
            updateGenerateButton();
        }, DEBOUNCE_DELAY);
    }

    /**
     * Handle picture QR code input changes
     */
    function handlePictureInput() {
        userInteracted.picture = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updateFormValidation();
            updateGenerateButton();
            detectUrl();
        }, DEBOUNCE_DELAY);
    }

    /**
     * Handle image upload
     */
    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            showError('Please select a valid image file.');
            return;
        }

        // Validate file size (2MB limit)
        if (file.size > 2 * 1024 * 1024) {
            showError('Image file size must be less than 2MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            originalImageDataUrl = e.target.result;
            uploadedImage = file;

            // Clear any existing errors since we have a valid image
            hideError();

            // Resize/crop the upload, then refresh preview and QR
            applyImageProcessing(file.name);
        };
        reader.readAsDataURL(file);
    }

    /**
     * Redraw the raw upload onto a canvas (downscale + optional square crop),
     * then refresh the preview, QR code and related UI.
     */
    async function applyImageProcessing(fileName) {
        if (!originalImageDataUrl) return;

        try {
            imageDataUrl = await processUploadedImage();
        } catch (error) {
            console.error('Failed to process image:', error);
            showError('Failed to process the uploaded image. Please try a different file.');
            return;
        }

        const name = fileName || (uploadedImage && uploadedImage.name) || 'image';
        showImagePreview(imageDataUrl, name);

        // Update QR code if text is already entered
        if (elements.pictureTextInput.value.trim()) {
            updateQrCode();
        }

        updateScannabilityIndicator();
        updateFormValidation();
        updateGenerateButton();
        updateDownloadButtons();
    }

    /**
     * Draw the raw upload onto an off-screen canvas, downscaling to
     * MAX_IMAGE_DIMENSION and (optionally) center-cropping to a square so the
     * logo is never stretched. Returns a PNG data URL (preserves transparency).
     */
    function processUploadedImage() {
        return new Promise((resolve, reject) => {
            if (!originalImageDataUrl) {
                resolve(null);
                return;
            }

            // Keep vector (SVG) logos pixel-perfect at any zoom — only rasterize
            // them if the user asked to crop to a square.
            const isSvg = uploadedImage && uploadedImage.type === 'image/svg+xml';
            const cropSquare = elements.pictureCropCheckbox.checked;
            if (isSvg && !cropSquare) {
                resolve(originalImageDataUrl);
                return;
            }

            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                if (cropSquare) {
                    // Center-crop to a square, then scale down to the max edge
                    const side = Math.min(img.width, img.height);
                    const target = Math.min(side, MAX_IMAGE_DIMENSION);
                    canvas.width = target;
                    canvas.height = target;
                    const sx = (img.width - side) / 2;
                    const sy = (img.height - side) / 2;
                    ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
                } else {
                    // Preserve aspect ratio, scale so the longest edge fits the max
                    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                }

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = function() {
                reject(new Error('Image could not be loaded'));
            };
            img.src = originalImageDataUrl;
        });
    }

    /**
     * Re-process the current upload when the crop option is toggled
     */
    function handleCropChange() {
        if (originalImageDataUrl) {
            applyImageProcessing();
        }
    }

    /**
     * Classify how scannable the current logo size is for the selected ECC level
     */
    function getScannabilityState(sizePercent, ecc) {
        const limits = SCANNABILITY[ecc] || SCANNABILITY.M;
        if (sizePercent <= limits.good) return 'good';
        if (sizePercent <= limits.risky) return 'risky';
        return 'bad';
    }

    /**
     * Update the live "Good / Risky / Won't scan" badge under the size slider
     */
    function updateScannabilityIndicator() {
        const badge = elements.scannability;
        if (!badge) return;

        // Only meaningful once an image is embedded
        if (elements.typeSelect.value !== 'picture' || !uploadedImage) {
            badge.className = 'scannability';
            badge.textContent = '';
            return;
        }

        const size = parseInt(elements.pictureSizeInput.value);
        const ecc = elements.eccSelect.value;
        const state = getScannabilityState(size, ecc);

        const messages = {
            good: 'Good — this logo size should scan reliably.',
            risky: 'Tight — test-scan before using, or raise error correction.',
            bad: "Too large — likely won't scan. Reduce size or use 'High' error correction."
        };

        badge.className = 'scannability is-visible scannability-' + state;
        badge.textContent = messages[state];
    }

    /**
     * When error correction changes, clamp an oversized logo back into the
     * scannable range and refresh the indicator / preview.
     */
    function handleEccChange() {
        const ecc = elements.eccSelect.value;
        const limits = SCANNABILITY[ecc] || SCANNABILITY.M;
        let size = parseInt(elements.pictureSizeInput.value);

        if (size > limits.risky) {
            size = limits.risky;
            elements.pictureSizeInput.value = size;
            if (elements.pictureSizeValue) {
                elements.pictureSizeValue.textContent = size + '%';
            }
        }

        updateScannabilityIndicator();

        // Live-refresh a picture QR so the new ECC/size takes effect immediately
        if (elements.typeSelect.value === 'picture' && uploadedImage && imageDataUrl &&
            elements.pictureTextInput.value.trim()) {
            updateQrCode();
        }
    }

    /**
     * Show image preview
     */
    function showImagePreview(dataUrl, fileName) {
        const preview = elements.picturePreview;
        preview.innerHTML = `
            <img src="${dataUrl}" alt="Uploaded image: ${fileName}" />
            <div class="picture-qr-info">
                <span class="picture-qr-info-icon">📷</span>
                <span>${fileName}</span>
            </div>
        `;
        preview.classList.add('has-image');
    }

    /**
     * Handle picture settings changes
     */
    function handlePictureSettingsChange() {
        // Update range value displays
        if (elements.pictureSizeValue) {
            elements.pictureSizeValue.textContent = elements.pictureSizeInput.value + '%';
        }

        // Refresh the scannability badge for the new size
        updateScannabilityIndicator();

        // Update QR code if we have both text and image
        if (elements.pictureTextInput.value.trim() && uploadedImage) {
            updateQrCode();
        }

        // Update download buttons
        updateDownloadButtons();
    }

    /**
     * Setup drag and drop for image upload
     */
    function setupImageDragAndDrop() {
        const uploadContainer = document.querySelector('.file-upload-container');
        if (!uploadContainer) return;

        uploadContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadContainer.classList.add('dragover');
        });

        uploadContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadContainer.classList.remove('dragover');
        });

        uploadContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadContainer.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                elements.pictureUploadInput.files = files;
                handleImageUpload({ target: { files: files } });
            }
        });
    }

    /**
     * Update password field visibility based on encryption type
     */
    function updatePasswordFieldVisibility() {
        const encryption = elements.wifiEncryptionSelect.value;
        
        if (encryption === 'nopass') {
            // Hide password field and clear its value
            elements.passwordFieldContainer.style.display = 'none';
            elements.wifiPasswordInput.value = '';
            elements.wifiPasswordInput.classList.remove('input-error');
            
            // Clear any password-related hints
            const passwordHint = document.getElementById('password-hint');
            if (passwordHint) {
                passwordHint.textContent = '';
                passwordHint.className = 'form-hint';
            }
        } else {
            // Show password field
            elements.passwordFieldContainer.style.display = 'grid';
        }
    }

    /**
     * Validate WiFi settings for consistency
     */
    function validateWifiSettings() {
        const encryption = elements.wifiEncryptionSelect.value;
        const password = elements.wifiPasswordInput.value;
        const passwordHint = document.getElementById('password-hint');
        
        // Clear previous validation
        elements.wifiPasswordInput.classList.remove('input-error');
        if (passwordHint) {
            passwordHint.className = 'form-hint';
            passwordHint.textContent = '';
        }
        
        // Only validate password if encryption requires it, field is visible, and user has interacted
        if (encryption !== 'nopass' && elements.passwordFieldContainer.style.display !== 'none' && userInteracted.wifi) {
            if ((encryption === 'WPA' || encryption === 'WEP') && !password.trim()) {
                elements.wifiPasswordInput.classList.add('input-error');
                if (passwordHint) {
                    passwordHint.className = 'form-hint form-error';
                    passwordHint.textContent = `Password is required for ${encryption} encryption`;
                }
            }
        }
    }

    /**
     * Toggle password visibility
     */
    function togglePasswordVisibility() {
        const passwordInput = elements.wifiPasswordInput;
        const toggleBtn = elements.togglePasswordBtn;
        const eyeIcon = toggleBtn.querySelector('.eye-icon');
        
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            eyeIcon.innerHTML = '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>';
        } else {
            passwordInput.type = 'password';
            eyeIcon.innerHTML = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
        }
    }



    /**
     * Build the input fields for a registry-defined QR type into the shared
     * dynamic container, matching the existing form-group/label/hint markup.
     */
    function renderRegistrySection(typeId) {
        const def = QR_TYPES[typeId];
        if (!def || !elements.dynamicFields) return;

        elements.dynamicFields.innerHTML = '';

        def.fields.forEach(field => {
            const group = document.createElement('div');
            group.className = 'form-group';

            const label = document.createElement('label');
            label.textContent = field.label + (field.required ? ' *' : '');
            label.setAttribute('for', `dyn-${field.id}`);
            group.appendChild(label);

            let input;
            if (field.type === 'textarea') {
                input = document.createElement('textarea');
            } else if (field.type === 'select') {
                input = document.createElement('select');
                (field.options || []).forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt.value;
                    o.textContent = opt.label;
                    input.appendChild(o);
                });
            } else {
                input = document.createElement('input');
                input.type = field.type || 'text';
            }
            input.id = `dyn-${field.id}`;
            input.dataset.fieldId = field.id;
            if (field.placeholder) input.placeholder = field.placeholder;
            input.addEventListener(field.type === 'select' ? 'change' : 'input', handleDynamicInput);
            group.appendChild(input);

            const hint = document.createElement('div');
            hint.className = 'form-hint';
            hint.id = `dyn-hint-${field.id}`;
            group.appendChild(hint);

            elements.dynamicFields.appendChild(group);
        });

        if (elements.dynamicTypeHint) {
            elements.dynamicTypeHint.textContent = def.hint || '';
            elements.dynamicTypeHint.className = 'form-hint';
        }
    }

    /**
     * Read the current field values for a registry type into a {id: value} map
     */
    function getRegistryValues() {
        const values = {};
        if (!elements.dynamicFields) return values;
        elements.dynamicFields.querySelectorAll('[data-field-id]').forEach(el => {
            values[el.dataset.fieldId] = el.value.trim();
        });
        return values;
    }

    /**
     * True when every required field of the registry type is filled in
     */
    function registryHasContent(typeId) {
        const def = QR_TYPES[typeId];
        if (!def) return false;
        const values = getRegistryValues();
        return def.fields.filter(f => f.required).every(f => (values[f.id] || '').length > 0);
    }

    /**
     * Show required-field errors for a registry type (gated on user interaction)
     */
    function validateRegistry(typeId) {
        const def = QR_TYPES[typeId];
        if (!def || !userInteracted.dynamic) return;

        def.fields.forEach(field => {
            if (!field.required) return;
            const el = elements.dynamicFields.querySelector(`[data-field-id="${field.id}"]`);
            const hint = document.getElementById(`dyn-hint-${field.id}`);
            if (!el) return;

            const valid = el.value.trim().length > 0;
            el.classList.toggle('input-error', !valid);
            if (hint) {
                hint.textContent = valid ? '' : `${field.label} is required`;
                hint.className = valid ? 'form-hint' : 'form-hint form-error';
            }
        });
    }

    /**
     * Debounced input handler for dynamically rendered registry fields
     */
    function handleDynamicInput() {
        userInteracted.dynamic = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updateFormValidation();
            updateGenerateButton();
            updateDownloadButtons();
        }, DEBOUNCE_DELAY);
    }

    /**
     * Clear and hide the dynamic registry section
     */
    function clearDynamicSection() {
        if (elements.dynamicFields) elements.dynamicFields.innerHTML = '';
        if (elements.dynamicTypeHint) {
            elements.dynamicTypeHint.textContent = '';
            elements.dynamicTypeHint.className = 'form-hint';
        }
        if (elements.dynamicInputSection) elements.dynamicInputSection.style.display = 'none';
    }

    /**
     * Generate a QR code for a registry-defined type
     */
    function generateRegistryQR(typeId) {
        if (isGenerating) return;

        isGenerating = true;
        elements.generateBtn.classList.add('loading');
        elements.generateBtn.disabled = true;

        try {
            const def = QR_TYPES[typeId];
            const values = getRegistryValues();
            const data = def.build(values);

            updateQrCodeWithData(data);

            const size = elements.sizeInput.value;
            const ecc = elements.eccSelect.value;
            const margin = elements.marginInput.value;
            elements.info.textContent = `${def.info(values)} | Size: ${size}×${size}px | ECC: ${ecc} | Margin: ${margin}px`;

            updateDownloadButtons();
            hideError();
        } catch (error) {
            console.error('Failed to generate QR code:', error);
            showError('Failed to generate QR code. Please check your input and try again.');
        } finally {
            isGenerating = false;
            elements.generateBtn.classList.remove('loading');
            updateGenerateButton();
        }
    }

    /**
     * Handle form submission (generate QR code)
     */
    function handleGenerate(e) {
        e.preventDefault();

        const type = elements.typeSelect.value;
        
        if (type === 'wifi') {
            const ssid = elements.wifiSsidInput.value.trim();
            if (!ssid) {
                showError('Please enter WiFi network name (SSID).');
                return;
            }
            generateWifiQR();
        } else if (type === 'contact') {
            const firstName = elements.contactFirstNameInput.value.trim();
            if (!firstName) {
                showError('Please enter first name for contact QR code.');
                return;
            }
            generateContactQR();
        } else if (type === 'picture') {
            const text = elements.pictureTextInput.value.trim();
            if (!text) {
                showError('Please enter text or URL to generate picture QR code.');
                return;
            }
            if (!uploadedImage) {
                showError('Please upload an image to generate picture QR code.');
                return;
            }
            generatePictureQR(text);
        } else if (QR_TYPES[type]) {
            if (!registryHasContent(type)) {
                userInteracted.dynamic = true;
                updateFormValidation();
                showError('Please fill in the required fields.');
                return;
            }
            generateRegistryQR(type);
        } else {
            const text = elements.textInput.value.trim();
            if (!text) {
                showError('Please enter text or URL to generate QR code.');
                return;
            }
            generateQR(text);
        }
        
        // Scroll to preview section
        setTimeout(() => {
            const previewSection = document.getElementById('preview');
            if (previewSection) {
                previewSection.scrollIntoView({ 
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }, 500); // Small delay to ensure QR code is generated
    }

    /**
     * Generate QR code with current settings
     */
    function generateQR(text) {
        if (isGenerating) return;

        isGenerating = true;
        elements.generateBtn.classList.add('loading');
        elements.generateBtn.disabled = true;

        try {
            updateQrCode();

            // Update UI
            updateInfo();
            updateDownloadButtons();



            // Clear any previous errors
            hideError();

        } catch (error) {
            console.error('Failed to generate QR code:', error);
            showError('Failed to generate QR code. Please check your input and try again.');
        } finally {
            isGenerating = false;
            elements.generateBtn.classList.remove('loading');
            updateGenerateButton();
        }
    }

    /**
     * Generate WiFi QR code
     */
    function generateWifiQR() {
        if (isGenerating) return;

        isGenerating = true;
        elements.generateBtn.classList.add('loading');
        elements.generateBtn.disabled = true;

        try {
            const ssid = elements.wifiSsidInput.value.trim();
            const password = elements.wifiPasswordInput.value;
            const encryption = elements.wifiEncryptionSelect.value;
            const hidden = elements.wifiHiddenCheckbox.checked;

            // Generate WiFi QR code string
            const wifiString = generateWifiString(ssid, password, encryption, hidden);
            
            // Update QR code with WiFi data
            updateQrCodeWithData(wifiString);

            // Update UI
            updateWifiInfo(ssid, encryption, hidden);
            updateDownloadButtons();



            // Clear any previous errors
            hideError();

        } catch (error) {
            console.error('Failed to generate WiFi QR code:', error);
            showError('Failed to generate WiFi QR code. Please check your input and try again.');
        } finally {
            isGenerating = false;
            elements.generateBtn.classList.remove('loading');
            updateGenerateButton();
        }
    }

    /**
     * Generate WiFi connection string
     */
    function generateWifiString(ssid, password, encryption, hidden) {
        // Escape special characters in SSID and password
        const escapedSsid = escapeWifiString(ssid);
        const escapedPassword = escapeWifiString(password);
        
        // Build WiFi string according to standard format
        let wifiString = `WIFI:S:${escapedSsid};`;
        
        if (encryption !== 'nopass') {
            wifiString += `T:${encryption};P:${escapedPassword};`;
        } else {
            wifiString += `T:nopass;`;
        }
        
        if (hidden) {
            wifiString += `H:true;`;
        }
        
        wifiString += `;;`;
        
        return wifiString;
    }

    /**
     * Escape special characters for WiFi string
     */
    function escapeWifiString(str) {
        if (!str) return '';
        return str.replace(/[\\;:,]/g, '\\$&');
    }

    /**
     * Update QR code with specific data
     */
    function updateQrCodeWithData(data) {
        if (!qrCode) return;

        const options = getCurrentOptions();
        options.data = data;
        currentData = data;
        qrCode.update(options);

        // Clear previous preview
        elements.preview.innerHTML = '';

        // Append new QR code
        qrCode.append(elements.preview);

        updateFramePreview();
    }

    /**
     * Update QR code with image data
     */
    function updateQrCodeWithImage(text) {
        if (!qrCode) return;

        const options = getCurrentOptions();
        currentData = options.data;
        qrCode.update(options);

        // Clear previous preview
        elements.preview.innerHTML = '';

        // Append new QR code
        qrCode.append(elements.preview);

        updateFramePreview();
    }

    /**
     * Generate Contact QR code
     */
    function generateContactQR() {
        if (isGenerating) return;

        isGenerating = true;
        elements.generateBtn.classList.add('loading');
        elements.generateBtn.disabled = true;

        try {
            const firstName = elements.contactFirstNameInput.value.trim();
            const lastName = elements.contactLastNameInput.value.trim();
            const phone = elements.contactPhoneInput.value.trim();
            const email = elements.contactEmailInput.value.trim();
            const company = elements.contactCompanyInput.value.trim();
            const jobTitle = elements.contactJobTitleInput.value.trim();
            const website = elements.contactWebsiteInput.value.trim();
            const address = elements.contactAddressInput.value.trim();

            // Generate vCard string
            const vCardString = generateVCardString(firstName, lastName, phone, email, company, jobTitle, website, address);
            
            // Update QR code with vCard data
            updateQrCodeWithData(vCardString);

            // Update UI
            updateContactInfo(firstName, lastName);
            updateDownloadButtons();



            // Clear any previous errors
            hideError();

        } catch (error) {
            console.error('Failed to generate Contact QR code:', error);
            showError('Failed to generate Contact QR code. Please check your input and try again.');
        } finally {
            isGenerating = false;
            elements.generateBtn.classList.remove('loading');
            updateGenerateButton();
        }
    }

    /**
     * Generate vCard string
     */
    function generateVCardString(firstName, lastName, phone, email, company, jobTitle, website, address) {
        let vCard = 'BEGIN:VCARD\nVERSION:3.0\n';
        
        // Name
        if (firstName || lastName) {
            vCard += `FN:${firstName} ${lastName}\n`;
            vCard += `N:${lastName};${firstName};;;\n`;
        }
        
        // Phone
        if (phone) {
            vCard += `TEL:${phone}\n`;
        }
        
        // Email
        if (email) {
            vCard += `EMAIL:${email}\n`;
        }
        
        // Company
        if (company) {
            vCard += `ORG:${company}\n`;
        }
        
        // Job Title
        if (jobTitle) {
            vCard += `TITLE:${jobTitle}\n`;
        }
        
        // Website
        if (website) {
            vCard += `URL:${website}\n`;
        }
        
        // Address
        if (address) {
            vCard += `ADR:;;${address}\n`;
        }
        
        vCard += 'END:VCARD';
        
        return vCard;
    }

    /**
     * Generate Picture QR code
     */
    function generatePictureQR(text) {
        if (isGenerating) return;

        isGenerating = true;
        elements.generateBtn.classList.add('loading');
        elements.generateBtn.disabled = true;

        try {
            // Update QR code with image
            updateQrCodeWithImage(text);

            // Update UI
            updatePictureInfo(text);
            updateDownloadButtons();



            // Clear any previous errors
            hideError();

        } catch (error) {
            console.error('Failed to generate Picture QR code:', error);
            showError('Failed to generate Picture QR code. Please check your input and try again.');
        } finally {
            isGenerating = false;
            elements.generateBtn.classList.remove('loading');
            updateGenerateButton();
        }
    }

    /**
     * Update info display for WiFi QR codes
     */
    function updateWifiInfo(ssid, encryption, hidden) {
        const size = elements.sizeInput.value;
        const ecc = elements.eccSelect.value;
        const margin = elements.marginInput.value;
        const encryptionText = encryption === 'nopass' ? 'No Password' : encryption;
        const hiddenText = hidden ? ' (Hidden)' : '';

        elements.info.textContent = `WiFi: ${ssid} | ${encryptionText}${hiddenText} | Size: ${size}×${size}px | ECC: ${ecc} | Margin: ${margin}px`;
    }

    /**
     * Update info display for Contact QR codes
     */
    function updateContactInfo(firstName, lastName) {
        const size = elements.sizeInput.value;
        const ecc = elements.eccSelect.value;
        const margin = elements.marginInput.value;
        const fullName = `${firstName} ${lastName}`.trim();

        elements.info.textContent = `Contact: ${fullName} | vCard Format | Size: ${size}×${size}px | ECC: ${ecc} | Margin: ${margin}px`;
    }

    /**
     * Update info display for Picture QR codes
     */
    function updatePictureInfo(text) {
        const size = elements.sizeInput.value;
        const ecc = elements.eccSelect.value;
        const margin = elements.marginInput.value;
        const textPreview = text.length > 50 ? text.substring(0, 50) + '...' : text;

        elements.info.textContent = `Picture QR: ${textPreview} | Size: ${size}×${size}px | ECC: ${ecc} | Margin: ${margin}px`;
    }

    /**
     * Update QR code with current settings
     */
    function updateQrCode() {
        if (!qrCode) return;

        const options = getCurrentOptions();
        currentData = options.data;
        qrCode.update(options);

        // Clear previous preview
        elements.preview.innerHTML = '';

        // Append new QR code
        qrCode.append(elements.preview);

        updateFramePreview();
    }

    /**
     * Get current QR code options from form
     */
    function getCurrentOptions() {
        const type = elements.typeSelect.value;
        let text = '';
        
        // Get text based on type
        if (type === 'picture') {
            text = elements.pictureTextInput.value.trim();
        } else {
            text = elements.textInput.value.trim();
        }
        
        const size = parseInt(elements.sizeInput.value);
        const margin = parseInt(elements.marginInput.value);
        const ecc = elements.eccSelect.value;
        const fgColor = elements.fgColorInput.value;
        const bgColor = elements.bgTransparentCheckbox.checked ? 'transparent' : elements.bgColorInput.value;

        // --- Style & branding options ---
        const dotStyle = elements.dotStyleSelect.value || 'rounded';
        const cornerColor = elements.cornerMatchCheckbox.checked ? fgColor : elements.cornerColorInput.value;
        // "Auto" (empty) corner styles are resolved to a concrete value so the
        // library merge never holds a stale type from a previous selection.
        const cornerSquareType = elements.cornerSquareStyleSelect.value || autoCornerStyle(dotStyle, 'square');
        const cornerDotType = elements.cornerDotStyleSelect.value || autoCornerStyle(dotStyle, 'dot');

        // Always pass gradient explicitly (object or null) so toggling it off resets it
        let dotsGradient = null;
        if (elements.gradientEnabledCheckbox.checked) {
            const choice = elements.gradientTypeSelect.value;
            const color2 = elements.gradientColorInput.value;
            const colorStops = [{ offset: 0, color: fgColor }, { offset: 1, color: color2 }];
            if (choice === 'radial') {
                dotsGradient = { type: 'radial', colorStops };
            } else {
                const deg = parseInt((choice.split('-')[1] || '0'), 10);
                dotsGradient = { type: 'linear', rotation: deg * Math.PI / 180, colorStops };
            }
        }

        const options = {
            width: size,
            height: size,
            data: text,
            margin: margin,
            qrOptions: {
                errorCorrectionLevel: ecc
            },
            dotsOptions: {
                color: fgColor,
                type: dotStyle,
                gradient: dotsGradient
            },
            cornersSquareOptions: {
                type: cornerSquareType,
                color: cornerColor
            },
            cornersDotOptions: {
                type: cornerDotType,
                color: cornerColor
            },
            backgroundOptions: {
                color: bgColor
            }
        };

        // Add image options for picture QR codes only
        if (type === 'picture' && uploadedImage && imageDataUrl) {
            const pictureSize = parseInt(elements.pictureSizeInput.value);
            
            options.imageOptions = {
                crossOrigin: 'anonymous',
                margin: 8,
                hideBackgroundDots: true,
                imageSize: pictureSize / 100
            };
            
            // Set image data
            options.image = imageDataUrl;
        } else {
            // For non-picture types, explicitly set no image and clear any existing image
            options.imageOptions = {
                crossOrigin: 'anonymous',
                margin: 20
            };
            // Explicitly remove any image data
            delete options.image;
            
            // Force clear image state for non-picture types
            if (uploadedImage || imageDataUrl || originalImageDataUrl) {
                uploadedImage = null;
                imageDataUrl = null;
                originalImageDataUrl = null;
            }
        }

        return options;
    }

    /**
     * Update info display
     */
    function updateInfo() {
        const size = elements.sizeInput.value;
        const ecc = elements.eccSelect.value;
        const margin = elements.marginInput.value;

        elements.info.textContent = `Size: ${size}×${size}px | ECC: ${ecc} | Margin: ${margin}px`;
    }

    /**
     * Update download button states
     */
    function updateDownloadButtons() {
        const type = elements.typeSelect.value;
        let hasContent = false;
        
        if (type === 'picture') {
            // For picture QR codes, check if we have both text and image
            const hasText = elements.pictureTextInput.value.trim().length > 0;
            const hasImage = uploadedImage && imageDataUrl;
            hasContent = hasText && hasImage;
        } else if (type === 'wifi') {
            // For WiFi QR codes, check if we have SSID
            hasContent = elements.wifiSsidInput.value.trim().length > 0;
        } else if (type === 'contact') {
            // For contact QR codes, check if we have first name
            hasContent = elements.contactFirstNameInput.value.trim().length > 0;
        } else if (QR_TYPES[type]) {
            hasContent = registryHasContent(type);
        } else {
            // For text/URL QR codes, check if we have text
            hasContent = elements.textInput.value.trim().length > 0;
        }
        
        elements.downloadBtn.disabled = !hasContent;
        elements.copyClipboardBtn.disabled = !hasContent;
    }

    /**
     * Update generate button state
     */
    function updateGenerateButton() {
        const type = elements.typeSelect.value;
        let hasContent = false;
        let hasErrors = false;
        
        // Check size and margin validation
        const size = parseInt(elements.sizeInput.value);
        const margin = parseInt(elements.marginInput.value);
        const isSizeValid = size >= SIZE_LIMITS.min && size <= SIZE_LIMITS.max;
        const isMarginValid = margin >= MARGIN_LIMITS.min && margin <= MARGIN_LIMITS.max;
        
        if (type === 'wifi') {
            const ssid = elements.wifiSsidInput.value.trim();
            const encryption = elements.wifiEncryptionSelect.value;
            const password = elements.wifiPasswordInput.value.trim();
            
            hasContent = ssid.length > 0;
            
            // Check for validation errors - only validate password if field is visible
            hasErrors = !hasContent || 
                       (encryption !== 'nopass' && 
                        elements.passwordFieldContainer.style.display !== 'none' && 
                        (encryption === 'WPA' || encryption === 'WEP') && 
                        !password);
        } else if (type === 'contact') {
            const firstName = elements.contactFirstNameInput.value.trim();
            hasContent = firstName.length > 0;
        } else if (type === 'picture') {
            const text = elements.pictureTextInput.value.trim();
            const hasImage = uploadedImage && imageDataUrl;
            hasContent = text.length > 0 && hasImage;
        } else if (QR_TYPES[type]) {
            hasContent = registryHasContent(type);
        } else {
            hasContent = elements.textInput.value.trim().length > 0;
        }

        // Include size and margin validation in overall error check
        hasErrors = hasErrors || !isSizeValid || !isMarginValid;
        
        elements.generateBtn.disabled = !hasContent || hasErrors || isGenerating;
    }

    /**
     * Update form validation
     */
    function updateFormValidation() {
        const type = elements.typeSelect.value;
        
        // Validate size and margin (common for both types)
        validateSizeAndMargin();
        
        if (type === 'wifi') {
            const ssid = elements.wifiSsidInput.value.trim();
            const encryption = elements.wifiEncryptionSelect.value;
            const password = elements.wifiPasswordInput.value.trim();
            
            // Validate SSID - only show error if user has interacted
            const isSsidValid = ssid.length > 0;
            if (userInteracted.wifi) {
                elements.wifiSsidInput.classList.toggle('input-error', !isSsidValid);

                if (!isSsidValid) {
                    document.getElementById('ssid-hint').textContent = 'Network name is required';
                    document.getElementById('ssid-hint').className = 'form-hint form-error';
                } else {
                    document.getElementById('ssid-hint').textContent = '';
                    document.getElementById('ssid-hint').className = 'form-hint';
                }
            }
            
            // Validate password for encryption type
            validateWifiSettings();
        } else if (type === 'contact') {
            const firstName = elements.contactFirstNameInput.value.trim();
            
            // Validate first name - only show error if user has interacted
            const isFirstNameValid = firstName.length > 0;
            if (userInteracted.contact) {
                elements.contactFirstNameInput.classList.toggle('input-error', !isFirstNameValid);

                if (!isFirstNameValid) {
                    document.getElementById('firstName-hint').textContent = 'First name is required';
                    document.getElementById('firstName-hint').className = 'form-hint form-error';
                } else {
                    document.getElementById('firstName-hint').textContent = '';
                    document.getElementById('firstName-hint').className = 'form-hint';
                }
            }
        } else if (type === 'picture') {
            const text = elements.pictureTextInput.value.trim();
            const isValid = text.length > 0;

            // Only show error if user has interacted
            if (userInteracted.picture) {
                elements.pictureTextInput.classList.toggle('input-error', !isValid);

                if (!isValid) {
                    const hintElement = document.getElementById('picture-text-hint');
                    if (hintElement) {
                        hintElement.textContent = 'This field is required';
                        hintElement.className = 'form-hint form-error';
                    }
                } else {
                    const hintElement = document.getElementById('picture-text-hint');
                    if (hintElement) {
                        hintElement.className = 'form-hint';
                    }
                }
            }
        } else if (QR_TYPES[type]) {
            validateRegistry(type);
        } else {
            const text = elements.textInput.value.trim();
            const isValid = text.length > 0;

            // Only show error if user has interacted
            if (userInteracted.text) {
                elements.textInput.classList.toggle('input-error', !isValid);

                if (!isValid) {
                    elements.textHint.textContent = 'This field is required';
                    elements.textHint.className = 'form-hint form-error';
                } else {
                    elements.textHint.className = 'form-hint';
                }
            }
        }
    }

    /**
     * Validate size and margin fields
     */
    function validateSizeAndMargin() {
        const size = parseInt(elements.sizeInput.value);
        const margin = parseInt(elements.marginInput.value);
        const sizeHint = document.getElementById('size-hint');
        const marginHint = document.getElementById('margin-hint');
        
        // Validate size - only show error if user has interacted
        const isSizeValid = size >= SIZE_LIMITS.min && size <= SIZE_LIMITS.max;
        if (userInteracted.size) {
            elements.sizeInput.classList.toggle('input-error', !isSizeValid);
            
            if (!isSizeValid) {
                if (sizeHint) {
                    sizeHint.textContent = `Size must be between ${SIZE_LIMITS.min} and ${SIZE_LIMITS.max} pixels`;
                    sizeHint.className = 'form-hint form-error';
                }
            } else {
                if (sizeHint) {
                    sizeHint.textContent = '';
                    sizeHint.className = 'form-hint';
                }
            }
        }
        
        // Validate margin - only show error if user has interacted
        const isMarginValid = margin >= MARGIN_LIMITS.min && margin <= MARGIN_LIMITS.max;
        if (userInteracted.margin) {
            elements.marginInput.classList.toggle('input-error', !isMarginValid);
            
            if (!isMarginValid) {
                if (marginHint) {
                    marginHint.textContent = `Quiet zone must be between ${MARGIN_LIMITS.min} and ${MARGIN_LIMITS.max} pixels`;
                    marginHint.className = 'form-hint form-error';
                }
            } else {
                if (marginHint) {
                    marginHint.textContent = '';
                    marginHint.className = 'form-hint';
                }
            }
        }
    }

    /**
     * Detect if input is a URL
     */
    function detectUrl() {
        const type = elements.typeSelect.value;
        let text = '';
        let hintElement = elements.textHint;
        
        if (type === 'picture') {
            text = elements.pictureTextInput.value.trim();
            hintElement = document.getElementById('picture-text-hint');
        } else {
            text = elements.textInput.value.trim();
        }
        
        if (!text || !hintElement) return;

        const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
        const isUrl = urlPattern.test(text);

        if (isUrl && !text.startsWith('http')) {
            hintElement.textContent = 'URL detected - will be encoded as https://' + text;
        } else if (isUrl) {
            hintElement.textContent = 'URL detected';
        } else {
            hintElement.textContent = '';
        }
    }

    /**
     * Handle reset button
     */
    function handleReset() {
        // Reset form to defaults
        elements.typeSelect.value = 'text';
        elements.textInput.value = '';
        elements.wifiSsidInput.value = '';
        elements.wifiPasswordInput.value = '';
        elements.wifiEncryptionSelect.value = 'WPA';
        elements.wifiHiddenCheckbox.checked = false;
        
        // Reset contact fields
        elements.contactFirstNameInput.value = '';
        elements.contactLastNameInput.value = '';
        elements.contactPhoneInput.value = '';
        elements.contactEmailInput.value = '';
        elements.contactCompanyInput.value = '';
        elements.contactJobTitleInput.value = '';
        elements.contactWebsiteInput.value = '';
        elements.contactAddressInput.value = '';
        
        // Reset picture QR code fields
        elements.pictureTextInput.value = '';
        elements.pictureUploadInput.value = '';
        elements.picturePreview.innerHTML = '';
        elements.picturePreview.classList.remove('has-image');
        elements.pictureSizeInput.value = DEFAULTS.pictureSize;
        if (elements.pictureSizeValue) {
            elements.pictureSizeValue.textContent = DEFAULTS.pictureSize + '%';
        }
        if (elements.pictureCropCheckbox) {
            elements.pictureCropCheckbox.checked = false;
        }
        updateScannabilityIndicator();

        // Reset uploaded image state
        uploadedImage = null;
        imageDataUrl = null;
        originalImageDataUrl = null;
        
        elements.sizeInput.value = DEFAULTS.size;
        elements.eccSelect.value = DEFAULTS.ecc;
        elements.marginInput.value = DEFAULTS.margin;
        elements.fgColorInput.value = DEFAULTS.fgColor;
        elements.bgColorInput.value = DEFAULTS.bgColor;
        elements.bgTransparentCheckbox.checked = DEFAULTS.bgTransparent;

        // Reset style & branding controls to defaults
        elements.dotStyleSelect.value = 'rounded';
        elements.cornerSquareStyleSelect.value = '';
        elements.cornerDotStyleSelect.value = '';
        elements.cornerColorInput.value = DEFAULTS.fgColor;
        elements.cornerColorInput.disabled = true;
        elements.cornerMatchCheckbox.checked = true;
        elements.gradientEnabledCheckbox.checked = false;
        elements.gradientColorInput.value = '#007bff';
        elements.gradientColorInput.disabled = true;
        elements.gradientTypeSelect.value = 'linear-45';
        elements.gradientTypeSelect.disabled = true;

        // Reset frame controls
        elements.frameEnabledCheckbox.checked = false;
        elements.frameTextInput.value = 'SCAN ME';
        elements.frameTextInput.disabled = true;
        elements.frameColorInput.value = DEFAULTS.fgColor;
        elements.frameColorInput.disabled = true;
        elements.framePositionSelect.value = 'bottom';
        elements.framePositionSelect.disabled = true;

        // Reset export options
        elements.exportFormatSelect.value = 'png';
        elements.exportResolutionSelect.value = '0';

        // Clear remembered render data
        currentData = '';

        // Reset password visibility
        elements.wifiPasswordInput.type = 'password';
        const eyeIcon = elements.togglePasswordBtn.querySelector('.eye-icon');
        eyeIcon.innerHTML = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';

        // Show text input section, hide other sections
        elements.textInputSection.style.display = 'block';
        elements.wifiInputSection.style.display = 'none';
        elements.contactInputSection.style.display = 'none';
        elements.pictureInputSection.style.display = 'none';
        clearDynamicSection();
        elements.textInput.setAttribute('required', '');
        elements.wifiSsidInput.removeAttribute('required');
        elements.contactFirstNameInput.removeAttribute('required');
        elements.pictureTextInput.removeAttribute('required');
        
        // Reset password field visibility
        if (elements.passwordFieldContainer) {
            elements.passwordFieldContainer.style.display = 'grid';
        }

        // Clear preview
        elements.preview.innerHTML = '';
        elements.info.textContent = '';

        // Update UI
        updateFormValidation();
        updateGenerateButton();
        updateDownloadButtons();
        hideError();
        
        // Reset user interaction state
        userInteracted = {
            size: false,
            margin: false,
            text: false,
            wifi: false,
            contact: false,
            picture: false,
            dynamic: false
        };
        
        // Clear any WiFi validation errors
        if (document.getElementById('password-hint')) {
            document.getElementById('password-hint').textContent = '';
            document.getElementById('password-hint').className = 'form-hint';
        }
        if (elements.wifiPasswordInput) {
            elements.wifiPasswordInput.classList.remove('input-error');
        }
        
        // Clear size and margin validation errors
        if (document.getElementById('size-hint')) {
            document.getElementById('size-hint').textContent = '';
            document.getElementById('size-hint').className = 'form-hint';
        }
        if (document.getElementById('margin-hint')) {
            document.getElementById('margin-hint').textContent = '';
            document.getElementById('margin-hint').className = 'form-hint';
        }
        if (elements.sizeInput) {
            elements.sizeInput.classList.remove('input-error');
        }
        if (elements.marginInput) {
            elements.marginInput.classList.remove('input-error');
        }
        
        // Hide error correction hint
        const eccHint = document.getElementById('ecc-hint');
        if (eccHint) {
            eccHint.style.display = 'none';
        }
    }

    /**
     * Completely clear QR code and image data
     */
    function clearQrCodeAndImage() {
        // Clear image state
        uploadedImage = null;
        imageDataUrl = null;
        originalImageDataUrl = null;
        
        // Clear preview
        if (elements.preview) {
            elements.preview.innerHTML = '';
        }
        if (elements.info) {
            elements.info.textContent = '';
        }
        
        // Reset QR code library
        if (qrCode) {
            qrCode.update({
                width: parseInt(elements.sizeInput.value),
                height: parseInt(elements.sizeInput.value),
                data: '',
                margin: parseInt(elements.marginInput.value),
                qrOptions: {
                    errorCorrectionLevel: elements.eccSelect.value
                },
                dotsOptions: {
                    color: elements.fgColorInput.value
                },
                backgroundOptions: {
                    color: elements.bgTransparentCheckbox.checked ? 'transparent' : elements.bgColorInput.value
                },
                imageOptions: {
                    crossOrigin: 'anonymous',
                    margin: 20
                }
            });
        }
    }

    /**
     * Reset form fields when type changes (without clearing common settings)
     */
    function resetFormOnTypeChange() {
        // Clear all input fields
        elements.textInput.value = '';
        elements.wifiSsidInput.value = '';
        elements.wifiPasswordInput.value = '';
        elements.wifiEncryptionSelect.value = 'WPA';
        elements.wifiHiddenCheckbox.checked = false;
        
        // Reset contact fields
        elements.contactFirstNameInput.value = '';
        elements.contactLastNameInput.value = '';
        elements.contactPhoneInput.value = '';
        elements.contactEmailInput.value = '';
        elements.contactCompanyInput.value = '';
        elements.contactJobTitleInput.value = '';
        elements.contactWebsiteInput.value = '';
        elements.contactAddressInput.value = '';
        
        // Reset picture QR code fields
        elements.pictureTextInput.value = '';
        elements.pictureUploadInput.value = '';
        elements.picturePreview.innerHTML = '';
        elements.picturePreview.classList.remove('has-image');
        elements.pictureSizeInput.value = DEFAULTS.pictureSize;
        if (elements.pictureSizeValue) {
            elements.pictureSizeValue.textContent = DEFAULTS.pictureSize + '%';
        }
        if (elements.pictureCropCheckbox) {
            elements.pictureCropCheckbox.checked = false;
        }

        // Reset uploaded image state and clear QR code
        clearQrCodeAndImage();
        updateScannabilityIndicator();
        clearDynamicSection();
        
        // Reset password visibility
        elements.wifiPasswordInput.type = 'password';
        const eyeIcon = elements.togglePasswordBtn.querySelector('.eye-icon');
        if (eyeIcon) {
            eyeIcon.innerHTML = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
        }
        
        // Reset password field visibility
        if (elements.passwordFieldContainer) {
            elements.passwordFieldContainer.style.display = 'grid';
        }

        // Clear preview
        elements.preview.innerHTML = '';
        elements.info.textContent = '';

        // Ensure no required attributes are set after reset
        removeRequiredFromHiddenInputs();

        // Update UI
        updateFormValidation();
        updateGenerateButton();
        updateDownloadButtons();
        hideError();
        
        // Reset user interaction state
        userInteracted = {
            size: false,
            margin: false,
            text: false,
            wifi: false,
            contact: false,
            picture: false,
            dynamic: false
        };
        
        // Clear any validation errors
        if (document.getElementById('password-hint')) {
            document.getElementById('password-hint').textContent = '';
            document.getElementById('password-hint').className = 'form-hint';
        }
        if (elements.wifiPasswordInput) {
            elements.wifiPasswordInput.classList.remove('input-error');
        }
        
        // Clear size and margin validation errors
        if (document.getElementById('size-hint')) {
            document.getElementById('size-hint').textContent = '';
            document.getElementById('size-hint').className = 'form-hint';
        }
        if (document.getElementById('margin-hint')) {
            document.getElementById('margin-hint').textContent = '';
            document.getElementById('margin-hint').className = 'form-hint';
        }
        if (elements.sizeInput) {
            elements.sizeInput.classList.remove('input-error');
        }
        if (elements.marginInput) {
            elements.marginInput.classList.remove('input-error');
        }
    }

    /**
     * Handle QR code type change
     */
    function handleTypeChange() {
        const type = elements.typeSelect.value;
        
        // Reset form when type changes
        resetFormOnTypeChange();
        
        // Hide all sections first
        elements.textInputSection.style.display = 'none';
        elements.wifiInputSection.style.display = 'none';
        elements.contactInputSection.style.display = 'none';
        elements.pictureInputSection.style.display = 'none';
        elements.dynamicInputSection.style.display = 'none';

        // Remove required attributes
        elements.textInput.removeAttribute('required');
        elements.wifiSsidInput.removeAttribute('required');
        elements.contactFirstNameInput.removeAttribute('required');
        elements.pictureTextInput.removeAttribute('required');

        if (type === 'wifi') {
            elements.wifiInputSection.style.display = 'block';
            elements.wifiSsidInput.setAttribute('required', '');
            
            // Initialize password field visibility
            updatePasswordFieldVisibility();
            
            // Hide hint for other types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        } else if (type === 'contact') {
            elements.contactInputSection.style.display = 'block';
            elements.contactFirstNameInput.setAttribute('required', '');
            
            // Hide hint for other types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        } else if (type === 'picture') {
            elements.pictureInputSection.style.display = 'block';
            elements.pictureTextInput.setAttribute('required', '');
            
            // Set error correction to High for picture QR codes
            elements.eccSelect.value = 'H';
            
            // Show hint about error correction
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'block';
                eccHint.style.color = 'var(--color-primary)';
                eccHint.style.fontWeight = '600';
            }
        } else if (QR_TYPES[type]) {
            elements.dynamicInputSection.style.display = 'block';
            renderRegistrySection(type);

            // Hide ECC hint for these types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        } else {
            // Text/URL type
            elements.textInputSection.style.display = 'block';
            elements.textInput.setAttribute('required', '');

            // Hide hint for other types
            const eccHint = document.getElementById('ecc-hint');
            if (eccHint) {
                eccHint.style.display = 'none';
            }
        }

        updateFormValidation();
        updateGenerateButton();
    }

    // ---- Frame & export helpers ------------------------------------------

    /**
     * Current "SCAN ME" frame settings from the Style panel
     */
    function getFrameConfig() {
        return {
            enabled: elements.frameEnabledCheckbox.checked,
            text: elements.frameTextInput.value || 'SCAN ME',
            color: elements.frameColorInput.value,
            position: elements.framePositionSelect.value
        };
    }

    /**
     * Enable/disable the frame inputs based on the frame toggle, then re-render
     */
    function handleFrameToggle() {
        const on = elements.frameEnabledCheckbox.checked;
        elements.frameTextInput.disabled = !on;
        elements.frameColorInput.disabled = !on;
        elements.framePositionSelect.disabled = !on;
        liveRefresh();
    }

    /**
     * The pixel size to export at — chosen resolution, or the preview size
     */
    function getExportSize() {
        const chosen = parseInt(elements.exportResolutionSelect.value, 10);
        return chosen > 0 ? chosen : parseInt(elements.sizeInput.value, 10);
    }

    /**
     * Build a full options object for a one-off export QRCodeStyling instance,
     * using the data string currently rendered (correct for every QR type).
     */
    function buildExportOptions(size) {
        const options = getCurrentOptions();
        options.data = currentData;
        if (size) {
            options.width = size;
            options.height = size;
        }
        return options;
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    function blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    function triggerDownload(url, filename, revoke) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Render the current QR (at the given size) to a PNG data URL
     */
    async function getQrPngDataUrl(size) {
        const exportQr = new QRCodeStyling(buildExportOptions(size));
        const blob = await exportQr.getRawData('png');
        return blobToDataURL(blob);
    }

    function roundRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, w, h, r);
            return;
        }
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /**
     * Composite the QR image inside a rounded frame with a labeled band, and
     * return the resulting canvas. Used for preview, modal, and downloads so
     * they always match.
     */
    async function composeFramedCanvas(qrDataUrl, qrSize, cfg) {
        const img = await loadImage(qrDataUrl);
        const border = Math.round(qrSize * 0.04);
        const gap = Math.round(qrSize * 0.04);
        const band = Math.round(qrSize * 0.17);
        const radius = Math.round(qrSize * 0.06);
        const innerW = qrSize + gap * 2;
        const W = innerW + border * 2;
        const H = border + gap * 2 + qrSize + band;
        const topBand = cfg.position === 'top';

        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        // Outer (frame + band) colour
        ctx.fillStyle = cfg.color;
        roundRectPath(ctx, 0, 0, W, H, radius);
        ctx.fill();

        // White area that holds the QR
        const whiteY = topBand ? band : border;
        const whiteH = qrSize + gap * 2;
        ctx.fillStyle = '#ffffff';
        roundRectPath(ctx, border, whiteY, innerW, whiteH, Math.round(radius * 0.55));
        ctx.fill();

        // The QR itself
        ctx.drawImage(img, border + gap, whiteY + gap, qrSize, qrSize);

        // Label
        ctx.fillStyle = '#ffffff';
        const fontStack = getComputedStyle(document.body).fontFamily || 'sans-serif';
        ctx.font = `bold ${Math.round(band * 0.42)}px ${fontStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const bandCenterY = topBand ? (band / 2) : (H - band / 2);
        ctx.fillText((cfg.text || 'SCAN ME').toUpperCase(), W / 2, bandCenterY);

        return canvas;
    }

    /**
     * When a frame is enabled, replace the live preview with the composited
     * framed canvas (async; a token drops stale renders).
     */
    async function updateFramePreview() {
        const cfg = getFrameConfig();
        if (!cfg.enabled || !qrCode || !currentData) return;

        const token = ++framePreviewToken;
        try {
            const size = parseInt(elements.sizeInput.value, 10);
            const dataUrl = await getQrPngDataUrl(size);
            const canvas = await composeFramedCanvas(dataUrl, size, cfg);
            if (token !== framePreviewToken) return; // superseded by a newer render
            elements.preview.innerHTML = '';
            elements.preview.appendChild(canvas);
        } catch (error) {
            console.error('Frame preview failed:', error);
        }
    }

    function savePdfFromImage(dataUrl, w, h, name) {
        const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDFCtor) {
            showError('PDF support failed to load. Please try another format.');
            return;
        }
        const orientation = w >= h ? 'landscape' : 'portrait';
        const pdf = new jsPDFCtor({ orientation, unit: 'pt', format: [w, h] });
        pdf.addImage(dataUrl, 'PNG', 0, 0, w, h);
        pdf.save(`${name}.pdf`);
    }

    function saveCanvas(canvas, name, format) {
        const mime = format === 'jpeg' ? 'image/jpeg'
            : format === 'webp' ? 'image/webp' : 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : format;
        canvas.toBlob((blob) => {
            if (!blob) {
                showError('Export failed. Please try again.');
                return;
            }
            triggerDownload(URL.createObjectURL(blob), `${name}.${ext}`, true);
        }, mime, 0.95);
    }

    function saveFramedSvg(canvas, name) {
        const dataUrl = canvas.toDataURL('image/png');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image href="${dataUrl}" width="${canvas.width}" height="${canvas.height}"/></svg>`;
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        triggerDownload(URL.createObjectURL(blob), `${name}.svg`, true);
    }

    /**
     * Download the QR in the chosen format/resolution, with or without a frame
     */
    async function downloadQR(format) {
        if (!qrCode || !currentData) return;

        format = format || elements.exportFormatSelect.value;
        const size = getExportSize();
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const name = `qr-${timestamp}`;
        const cfg = getFrameConfig();

        try {
            if (cfg.enabled) {
                // Framed: composite onto a canvas, then export that
                const dataUrl = await getQrPngDataUrl(size);
                const canvas = await composeFramedCanvas(dataUrl, size, cfg);
                if (format === 'pdf') {
                    savePdfFromImage(canvas.toDataURL('image/png'), canvas.width, canvas.height, name);
                } else if (format === 'svg') {
                    saveFramedSvg(canvas, name);
                } else {
                    saveCanvas(canvas, name, format);
                }
            } else if (format === 'pdf') {
                const dataUrl = await getQrPngDataUrl(size);
                const img = await loadImage(dataUrl);
                savePdfFromImage(dataUrl, img.width, img.height, name);
            } else {
                // Unframed raster/svg straight from a one-off instance
                const exportQr = new QRCodeStyling(buildExportOptions(size));
                await exportQr.download({ name, extension: format });
            }
        } catch (error) {
            console.error('Download failed:', error);
            showError('Failed to download QR code. Please try again.');
        }
    }

    /**
     * Copy the QR (framed if enabled) to the clipboard as a PNG
     */
    async function copyToClipboard() {
        if (!qrCode || !currentData) return;

        try {
            let blob;
            const cfg = getFrameConfig();
            if (cfg.enabled) {
                const size = getExportSize();
                const dataUrl = await getQrPngDataUrl(size);
                const canvas = await composeFramedCanvas(dataUrl, size, cfg);
                blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            } else {
                blob = await qrCode.getRawData('png');
            }

            if (blob && navigator.clipboard && navigator.clipboard.write) {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                showSuccess('QR code copied to clipboard!');
            } else {
                showError('Clipboard API not supported in this browser.');
            }
        } catch (error) {
            console.error('Copy to clipboard failed:', error);
            showError('Failed to copy QR code to clipboard.');
        }
    }

    /**
     * Show error message
     */
    function showError(message) {
        const type = elements.typeSelect.value;
        let hintElement = elements.textHint;

        if (type === 'picture') {
            hintElement = document.getElementById('picture-text-hint');
        } else if (QR_TYPES[type]) {
            hintElement = elements.dynamicTypeHint;
        }

        if (hintElement) {
            hintElement.textContent = message;
            hintElement.className = 'form-hint form-error';
        }
    }

    /**
     * Hide error message
     */
    function hideError() {
        const type = elements.typeSelect.value;
        let hintElement = elements.textHint;

        if (type === 'picture') {
            hintElement = document.getElementById('picture-text-hint');
        } else if (QR_TYPES[type]) {
            // Restore the type's help hint rather than blanking it
            if (elements.dynamicTypeHint) {
                elements.dynamicTypeHint.textContent = QR_TYPES[type].hint || '';
                elements.dynamicTypeHint.className = 'form-hint';
            }
            return;
        }

        if (hintElement) {
            hintElement.textContent = '';
            hintElement.className = 'form-hint';
        }
    }

    /**
     * Show success message
     */
    function showSuccess(message) {
        // Create a temporary success message element
        const successMessage = document.createElement('div');
        successMessage.className = 'success-message';
        successMessage.textContent = message;
        successMessage.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: var(--color-success);
            color: white;
            padding: 12px 20px;
            border-radius: var(--border-radius);
            font-weight: 600;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            animation: slideIn 0.3s ease-out;
        `;

        // Add animation keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);

        // Add to page
        document.body.appendChild(successMessage);

        // Remove after 3 seconds with animation
        setTimeout(() => {
            successMessage.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                if (successMessage.parentNode) {
                    successMessage.parentNode.removeChild(successMessage);
                }
            }, 300);
        }, 3000);
    }

    /**
     * Open the full-size QR preview modal.
     *
     * We render a standalone copy via the library's getRawData() rather than
     * cloning the live SVG: cloning duplicates the SVG's internal element IDs,
     * which breaks the url(#...)/href references the embedded logo and dot
     * masking depend on (the logo would render incorrectly or not at all).
     * An <img> of the serialized SVG is fully self-contained and crisp.
     */
    async function openQrModal() {
        if (!elements.qrModal || !qrCode) return;

        const node = elements.preview.querySelector('svg') ||
                     elements.preview.querySelector('canvas');
        if (!node) return; // nothing generated yet

        elements.qrModalBody.innerHTML = '';

        let shown = false;

        // Framed view: show the composited canvas so the modal matches the
        // preview and downloads.
        const frameCfg = getFrameConfig();
        if (frameCfg.enabled && currentData) {
            try {
                const size = parseInt(elements.sizeInput.value, 10);
                const dataUrl = await getQrPngDataUrl(size);
                const canvas = await composeFramedCanvas(dataUrl, size, frameCfg);
                elements.qrModalBody.appendChild(canvas);
                shown = true;
            } catch (error) {
                console.error('Framed modal render failed:', error);
            }
        }

        if (!shown) {
            try {
                const blob = await qrCode.getRawData('svg');
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = 'QR code full preview';
                    img.dataset.objectUrl = url; // tracked so we can revoke on close
                    elements.qrModalBody.appendChild(img);
                    shown = true;
                }
            } catch (error) {
                console.error('Failed to render full-size QR:', error);
            }
        }

        // Fallback: serialize the live SVG into a self-contained image
        if (!shown) {
            try {
                const xml = new XMLSerializer().serializeToString(node);
                const blob = new Blob([xml], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const img = document.createElement('img');
                img.src = url;
                img.alt = 'QR code full preview';
                img.dataset.objectUrl = url;
                elements.qrModalBody.appendChild(img);
                shown = true;
            } catch (error) {
                console.error('Fallback render failed:', error);
            }
        }

        if (!shown) return; // couldn't render anything

        elements.qrModal.hidden = false;
        document.body.style.overflow = 'hidden'; // prevent background scroll
        elements.qrModalClose.focus();
    }

    /**
     * Close the full-size QR preview modal
     */
    function closeQrModal() {
        if (!elements.qrModal) return;

        // Release the blob URL we created for the modal image
        const img = elements.qrModalBody.querySelector('img[data-object-url]');
        if (img && img.dataset.objectUrl) {
            URL.revokeObjectURL(img.dataset.objectUrl);
        }

        elements.qrModal.hidden = true;
        elements.qrModalBody.innerHTML = '';
        document.body.style.overflow = '';
    }

    /**
     * Load theme preference from localStorage
     */
    function loadThemePreference() {
        try {
            const savedTheme = localStorage.getItem('qr-theme');
            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

            let theme = 'system'; // default

            if (savedTheme === 'light' || savedTheme === 'dark') {
                theme = savedTheme;
            } else if (savedTheme === 'system' || savedTheme === null) {
                theme = systemPrefersDark ? 'dark' : 'light';
            }

            applyTheme(theme);
            updateThemeIcon(theme);

            // Listen for system theme changes
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (localStorage.getItem('qr-theme') === 'system') {
                    const newTheme = e.matches ? 'dark' : 'light';
                    applyTheme(newTheme);
                    updateThemeIcon('system');
                }
            });

        } catch (error) {
            console.error('Failed to load theme preference:', error);
        }
    }

    /**
     * Toggle theme (cycles through light -> dark)
     */
    function toggleTheme() {
        try {
            const currentTheme = localStorage.getItem('qr-theme') || 'light';
            let newTheme;

            if (currentTheme === 'light') {
                newTheme = 'dark';
            } else {
                newTheme = 'light';
            }

            localStorage.setItem('qr-theme', newTheme);
            applyTheme(newTheme);
            updateThemeIcon(newTheme);

        } catch (error) {
            console.error('Failed to toggle theme:', error);
        }
    }

    /**
     * Apply theme to document
     */
    function applyTheme(theme) {
        const root = document.documentElement;

        if (theme === 'dark') {
            root.setAttribute('data-theme', 'dark');
        } else if (theme === 'light') {
            root.setAttribute('data-theme', 'light');
        } else {
            // System preference
            root.removeAttribute('data-theme');
        }
    }

    /**
     * Update theme toggle icon
     */
    function updateThemeIcon(theme) {
        if (!elements.themeIcon) return;

        if (theme === 'dark') {
            elements.themeIcon.textContent = '☀️';
            elements.themeToggle.setAttribute('aria-label', 'Switch to light mode');
        } else {
            elements.themeIcon.textContent = '🌙';
            elements.themeToggle.setAttribute('aria-label', 'Switch to dark mode');
        }
    }

    // Initialize the application when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
