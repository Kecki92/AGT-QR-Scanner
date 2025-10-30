/* ====== APP KONFIGURATION ====== */
const CONFIG = {
    fromEmail: 'lager9611@gmail.com',   // Fallback, falls kein Absender hinterlegt
    fromName: 'QR-Code Scanner System', // Fallback
    subject: 'Neue Bestellung via QR-Scanner',
    scanner: {
        autoScan: false,        // Einzel-Scan nur auf Button
        pauseAfterScan: 1200
    },
    storageKeys: {
        orders: 'qrScannerOrders',
        cameraAllowed: 'qrScannerCameraAllowed',
        settings: 'qrScannerSettings'
    },
    defaults: {
        salutation: 'Sehr geehrte Damen und Herren,'
    }
};

/* ====== GLOBALE VARIABLEN ====== */
let orders = [];
let videoStream = null;
let emailjsInitialized = false;

/* ====== ELEMENTE CACHING ====== */
const elements = {
    // Scanner
    scannerContainer: document.getElementById('scanner-container'),
    qrVideo: document.getElementById('qr-video'),
    qrCanvas: document.getElementById('qr-canvas'),
    scanNow: document.getElementById('scan-now'),
    uploadImage: document.getElementById('upload-image'),
    scannerStatus: document.getElementById('scanner-status'),

    // Orders
    orderList: document.getElementById('order-list'),
    totalArticles: document.getElementById('total-articles'),
    totalQuantity: document.getElementById('total-quantity'),
    clearOrders: document.getElementById('clear-orders'),

    // Mail compose
    customMessage: document.getElementById('custom-message'),
    emailPreview: document.getElementById('email-preview'),
    emailPreviewContainer: document.getElementById('email-preview-container'),
    closePreview: document.getElementById('close-preview'),
    previewEmail: document.getElementById('preview-email'),
    sendOrder: document.getElementById('send-order'),
    copyToClipboard: document.getElementById('copy-to-clipboard'),
    emailStatus: document.getElementById('email-status'),
    sendingProgress: document.getElementById('sending-progress'),

    // Settings modal
    settingsModal: document.getElementById('settings-modal'),
    menuToggle: document.getElementById('menu-toggle'),
    closeModal: document.getElementById('close-modal'),
    emailjsService: document.getElementById('emailjs-service'),
    emailjsTemplate: document.getElementById('emailjs-template'),
    emailjsPublic: document.getElementById('emailjs-public'),
    toEmail: document.getElementById('to-email'),

    // NEW personalization
    emailSalutation: document.getElementById('email-salutation'),
    senderName: document.getElementById('sender-name'),
    senderEmail: document.getElementById('sender-email'),

    testEmailjs: document.getElementById('test-emailjs'),
    saveSettings: document.getElementById('save-settings')
};

/* ====== UTIL ====== */
function validateElements() {
    const missing = [];
    for (const [k, el] of Object.entries(elements)) if (!el) missing.push(k);
    if (missing.length) console.warn('⚠️ Fehlende HTML-Elemente:', missing.join(', '));
}
const Clamp = (v, min, max) => Math.min(max, Math.max(min, v | 0));

/* ====== STATUS ====== */
class StatusManager {
    static showStatus(message, type = 'info', duration = 3000) {
        const el = elements.emailStatus; if (!el) return;
        el.innerHTML = `<div class="status-message ${type}">${message}</div>`;
        if (type === 'success' && duration > 0) {
            setTimeout(() => { if (el.innerHTML.includes(message)) el.innerHTML = ''; }, duration);
        }
    }
    static showScannerStatus(message, type = 'info') {
        const el = elements.scannerStatus; if (!el) return;
        el.className = `status-message ${type}`;
        el.textContent = message;
    }
    static showLoading(button, show = true) {
        if (!button) return;
        if (show) {
            button.disabled = true;
            const originalText = button.textContent;
            button.dataset.originalText = originalText;
            button.innerHTML = `<span class="loading-spinner"></span> ${originalText}`;
        } else {
            button.disabled = false;
            const originalText = button.dataset.originalText || button.textContent;
            button.textContent = originalText;
        }
    }
}

/* ====== STORAGE ====== */
class OrderStorage {
    static saveOrders() {
        try { localStorage.setItem(CONFIG.storageKeys.orders, JSON.stringify(orders)); }
        catch (e) { console.warn('⚠️ Konnte Bestellungen nicht speichern:', e); }
    }
    static loadOrders() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKeys.orders);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(o => ({
                artikel: String(o.artikel || 'Unbekannter Artikel'),
                menge: Math.max(1, parseInt(o.menge || 1, 10)),
                beschreibung: String(o.beschreibung || ''),
                id: o.id || Date.now() + Math.random().toString(36).slice(2)
            }));
        } catch (e) { console.warn('⚠️ Konnte Bestellungen nicht laden:', e); return []; }
    }
    static setCameraAllowed(v = true) { try { localStorage.setItem(CONFIG.storageKeys.cameraAllowed, v ? '1' : '0'); } catch { } }
    static getCameraAllowed() { try { return localStorage.getItem(CONFIG.storageKeys.cameraAllowed) === '1'; } catch { return false; } }

    static loadSettings() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKeys.settings);
            if (!raw) return {};
            return JSON.parse(raw) || {};
        } catch { return {}; }
    }
    static saveSettings(obj) {
        try { localStorage.setItem(CONFIG.storageKeys.settings, JSON.stringify(obj)); } catch { }
    }
}

/* ====== ORDERS ====== */
class OrderManager {
    static addOrder(article, quantity = 1, description = '') {
        const order = {
            artikel: article,
            menge: Math.max(1, quantity),
            beschreibung: description,
            id: Date.now() + Math.random().toString(36).substr(2, 9)
        };
        const i = orders.findIndex(o => o.artikel === order.artikel && o.beschreibung === order.beschreibung);
        if (i >= 0) {
            orders[i].menge += order.menge;
            StatusManager.showScannerStatus(`📦 Menge erhöht: ${order.artikel}`, 'success');
        } else {
            orders.push(order);
            StatusManager.showScannerStatus(`✅ Erfasst: ${order.artikel}`, 'success');
        }
        this.updateOrderList();
        OrderStorage.saveOrders();
    }

    static removeOrder(index) {
        if (index < 0 || index >= orders.length) return;
        const removed = orders.splice(index, 1)[0];
        StatusManager.showStatus(`🗑️ Entfernt: ${removed.artikel}`, 'info', 2000);
        this.updateOrderList();
        OrderStorage.saveOrders();
    }

    static setQuantity(index, value) {
        if (index < 0 || index >= orders.length) return;
        let v = parseInt(String(value).replace(/[^\d]/g, ''), 10);
        v = Clamp(isNaN(v) ? 1 : v, 1, 100000);
        orders[index].menge = v;
        this.updateOrderList();
        OrderStorage.saveOrders();
    }

    static clearOrders() {
        if (!orders.length) return;
        orders = [];
        this.updateOrderList();
        OrderStorage.saveOrders();
        StatusManager.showStatus('🗑️ Alle Bestellungen wurden gelöscht', 'info', 2000);
    }

    static updateOrderList() {
        if (!elements.orderList) return;
        elements.totalArticles.textContent = String(orders.length);
        elements.totalQuantity.textContent = String(orders.reduce((s, o) => s + o.menge, 0));

        if (!orders.length) {
            elements.orderList.innerHTML = '<div class="status-message info">📭 Noch keine Artikel gescannt</div>';
            return;
        }

        elements.orderList.innerHTML = orders.map((order, index) => `
      <div class="order-item">
        <div class="order-item-header">
          <div class="order-item-title">${this.escapeHtml(order.artikel)}</div>
          <div class="order-item-quantity">${order.menge}x</div>
        </div>
        ${order.beschreibung ? `<div class="order-item-details">${this.escapeHtml(order.beschreibung)}</div>` : ''}
        <div class="quantity-controls">
          <label for="qty-${index}" class="sr-only">Menge</label>
          <span>Menge:</span>
          <input
            id="qty-${index}"
            class="qty-input"
            type="number"
            inputmode="numeric"
            pattern="[0-9]*"
            min="1"
            step="1"
            value="${order.menge}"
            data-index="${index}"
            aria-label="Menge für ${this.escapeHtml(order.artikel)}"
          />
          <button class="btn btn-danger quantity-btn" onclick="OrderManager.removeOrder(${index})">🗑️</button>
        </div>
      </div>
    `).join('');
    }

    static escapeHtml(unsafe) {
        return String(unsafe)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
}

/* ====== QR (Einzel-Scan) ====== */
class QRScanner {
    static async hasGrantedPermissionHint() {
        if (OrderStorage.getCameraAllowed()) return true;
        try {
            if (navigator.permissions?.query) {
                const p = await navigator.permissions.query({ name: 'camera' });
                return p.state === 'granted';
            }
        } catch { }
        return false;
    }

    static async startCamera() {
        if (location.protocol !== 'https:' && location.hostname !== 'localhost')
            throw new Error('Kamera-Zugriff erfordert HTTPS oder localhost.');
        if (!navigator.mediaDevices?.getUserMedia) {
            StatusManager.showScannerStatus('❌ Kamera wird nicht unterstützt', 'error');
            return false;
        }
        if (typeof jsQR === 'undefined') {
            StatusManager.showScannerStatus('❌ QR-Scanner Bibliothek nicht geladen', 'error');
            return false;
        }

        try {
            StatusManager.showScannerStatus('📷 Kamera wird gestartet...', 'info');

            videoStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });

            const video = elements.qrVideo;
            video.srcObject = videoStream;

            await new Promise((resolve, reject) => {
                const onReady = () => { video.play().then(resolve).catch(reject); video.removeEventListener('loadedmetadata', onReady); };
                video.addEventListener('loadedmetadata', onReady);
                if (video.readyState >= 1) onReady();
            });

            elements.scannerContainer?.classList.remove('hidden');
            elements.scanNow.disabled = false;

            OrderStorage.setCameraAllowed(true);

            StatusManager.showScannerStatus('✅ Kamera bereit – „Jetzt scannen“ startet einen Einzel-Scan', 'success');
            return true;
        } catch (error) {
            this.handleCameraError(error);
            return false;
        }
    }

    static stopCamera() {
        if (videoStream) {
            videoStream.getTracks().forEach(t => t.stop());
            videoStream = null;
        }
        if (elements.qrVideo) elements.qrVideo.srcObject = null;
        elements.scanNow.disabled = true;
        elements.scannerContainer?.classList.add('hidden');
        StatusManager.showScannerStatus('⏸️ Kamera gestoppt', 'info');
    }

    static singleScan() {
        if (!videoStream || !elements.qrVideo) {
            StatusManager.showScannerStatus('❌ Kamera nicht aktiv', 'error');
            return;
        }

        const video = elements.qrVideo;
        if (!video.videoWidth || !video.videoHeight) {
            StatusManager.showScannerStatus('⏳ Kamera initialisiert noch…', 'info');
            return;
        }

        try {
            const canvas = elements.qrCanvas;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });

            if (code && code.data) {
                this.handleScannedCode(code.data);
            } else {
                StatusManager.showScannerStatus('❌ Kein QR-Code im Bild gefunden', 'error');
            }
        } catch (err) {
            console.error('❌ Single-Scan Fehler:', err);
            StatusManager.showScannerStatus(`❌ ${err?.message || err}`, 'error');
        }
    }

    static async scanImageFile(file) {
        if (!file) return;
        if (typeof jsQR === 'undefined') {
            StatusManager.showStatus('❌ QR-Scanner Bibliothek nicht geladen', 'error');
            return;
        }

        try {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

            const canvas = elements.qrCanvas;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);

            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' });

            URL.revokeObjectURL(url);

            if (code && code.data) {
                this.handleScannedCode(code.data);
            } else {
                StatusManager.showStatus('❌ In diesem Bild wurde kein QR-Code erkannt', 'error');
            }
        } catch (err) {
            console.error('❌ Bild-Scan Fehler:', err);
            StatusManager.showStatus(`❌ ${err?.message || err}`, 'error');
        }
    }

    static handleScannedCode(data) {
        if (!data || !data.trim()) {
            StatusManager.showScannerStatus('❌ Ungültiger QR-Code', 'error');
            return;
        }
        try {
            const parsed = this.parseQRData(data);
            OrderManager.addOrder(parsed.artikel, parsed.menge, parsed.beschreibung);
            StatusManager.showScannerStatus('🎉 QR-Code erfolgreich gescannt!', 'success');
        } catch (error) {
            console.error('❌ QR-Code Verarbeitungsfehler:', error);
            StatusManager.showScannerStatus('❌ Fehler beim Verarbeiten des QR-Codes', 'error');
        }
    }

    static parseQRData(data) {
        if (!data) return { artikel: 'Ungültiger QR-Code', menge: 1, beschreibung: '' };
        try {
            const obj = JSON.parse(data);
            return {
                artikel: obj.artikel || obj.name || obj.title || obj.product || 'Unbekannter Artikel',
                menge: Math.max(1, Number(obj.menge || obj.quantity || obj.amount || 1)),
                beschreibung: obj.beschreibung || obj.description || obj.details || ''
            };
        } catch {
            return this.analyzeTextContent(data);
        }
    }

    static analyzeTextContent(text) {
        const cleanText = text.trim();
        const lines = cleanText.split('\n').filter(l => l.trim());
        let artikel = 'Unbekannter Artikel';
        let menge = 1;
        let beschreibung = '';

        if (lines.length > 0) {
            const artikelLines = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line.match(/^(ALU|GLAS)$/i)) continue;
                if (line.match(/Bestellmenge:/i)) continue;

                const mengeMatch = line.match(/(\d+)\s*(STK|Stk|Stück|stk|stück|Stck|stck|PCS|pcs)/i);
                if (mengeMatch) { menge = parseInt(mengeMatch[1]); continue; }

                if (line && !/^\d/.test(line)) artikelLines.push(line);
            }

            artikel = artikelLines.join(' ').trim();

            if (menge === 1) {
                const nums = cleanText.match(/\b\d+\b/g);
                if (nums) {
                    const candidates = nums.map(n => parseInt(n, 10)).filter(n => n > 1 && n < 10000);
                    if (candidates.length) menge = Math.max(...candidates);
                }
            }

            const techDetails = lines.filter(line =>
                line.match(/ISO\s*\d+/i) ||
                line.match(/[A-ZÄÖÜ]+[\s-]*\d+[xX]\d+/) ||
                line.match(/[A-Za-zÄÖÜäöü]+\s*[A-Za-zÄÖÜäöü]*\s*\d+/)
            );
            if (techDetails.length) beschreibung = techDetails.join(', ');
        }

        artikel = this.cleanArticleName(artikel);
        return { artikel: artikel || 'Unbekannter Artikel', menge: Math.max(1, menge), beschreibung };
    }

    static cleanArticleName(name) {
        if (!name) return 'Unbekannter Artikel';
        return name
            .replace(/^ALU\s*-?\s*/gi, '')
            .replace(/^GLAS\s*-?\s*/gi, '')
            .replace(/\s*Bestellmenge:.*$/gi, '')
            .replace(/\s*\d+\s*(STK|Stk|Stück).*$/gi, '')
            .trim()
            .substring(0, 100);
    }

    static handleCameraError(error) {
        console.error('📹 Kamera-Fehler Details:', error);
        let errorMessage = 'Kamera-Fehler: ';
        if (error.name === 'NotAllowedError') errorMessage = '❌ Kamera-Zugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben.';
        else if (error.name === 'NotFoundError') errorMessage = '❌ Keine Kamera gefunden.';
        else if (error.name === 'NotSupportedError') errorMessage = '❌ Kamera wird nicht unterstützt.';
        else if (error.name === 'NotReadableError') errorMessage = '❌ Kamera wird bereits von einer anderen Anwendung verwendet.';
        else errorMessage = `❌ Kamera-Fehler: ${error.message || error}`;
        StatusManager.showScannerStatus(errorMessage, 'error');
    }
}

/* ====== EMAIL ====== */
class EmailManager {
    static _readSettingsForMail() {
        // Live aus DOM lesen, damit Änderungen ohne Reload wirken
        const salutation = (elements.emailSalutation.value || CONFIG.defaults.salutation).trim();
        const senderName = (elements.senderName.value || '').trim();
        const senderEmail = (elements.senderEmail.value || '').trim();
        const fromName = senderName || CONFIG.fromName;
        const fromEmail = senderEmail || CONFIG.fromEmail;
        return { salutation, senderName, senderEmail, fromName, fromEmail };
    }

    static initialize() {
        try {
            const serviceId = elements.emailjsService.value.trim();
            const templateId = elements.emailjsTemplate.value.trim();
            const publicKey = elements.emailjsPublic.value.trim();
            const toEmail = elements.toEmail.value.trim();

            if (!serviceId || !templateId || !publicKey || !toEmail) {
                throw new Error('Bitte alle E-Mail Felder in den Einstellungen ausfüllen');
            }
            if (emailjsInitialized) return true;
            if (typeof emailjs === 'undefined') throw new Error('EmailJS SDK konnte nicht geladen werden');

            emailjs.init(publicKey);
            emailjsInitialized = true;
            return true;
        } catch (error) {
            StatusManager.showStatus(error.message, 'error');
            return false;
        }
    }

    static createEmailContent() {
        if (orders.length === 0) throw new Error('Keine Bestellungen vorhanden');

        const { salutation, senderName, fromName, fromEmail } = this._readSettingsForMail();

        let content = `${salutation}\n\n`;
        content += `hiermit bestelle ich folgende Artikel:\n\n`;

        orders.forEach((order, index) => {
            content += `${index + 1}. ${order.artikel} - ${order.menge} Stück\n`;
            if (order.beschreibung) content += `   Beschreibung: ${order.beschreibung}\n`;
        });

        const totalArticles = orders.length;
        const totalQuantity = orders.reduce((sum, order) => sum + order.menge, 0);

        content += `\nZusammenfassung:\n`;
        content += `- Artikel: ${totalArticles}\n`;
        content += `- Gesamtmenge: ${totalQuantity} Stück\n`;
        content += `- Bestellt von: ${senderName || fromName}\n\n`;

        content += `Mit freundlichen Grüßen\n`;
        content += `${fromName}\n${fromEmail}\n`;

        const customMessage = elements.customMessage.value.trim();
        if (customMessage) content += `\nZusätzliche Nachricht:\n${customMessage}\n`;

        content += `\n---\nGesendet via QR-Scanner App | ${new Date().toLocaleString('de-DE')}`;
        return content;
    }

    static showPreview() {
        try {
            const content = this.createEmailContent();
            elements.emailPreview.textContent = content;
            elements.emailPreviewContainer.classList.remove('hidden');
            StatusManager.showStatus('📧 E-Mail Vorschau wurde generiert', 'success');
        } catch (error) {
            StatusManager.showStatus(error.message, 'error');
        }
    }
    static closePreview() { elements.emailPreviewContainer.classList.add('hidden'); }

    static async send() {
        if (orders.length === 0) { StatusManager.showStatus('❌ Keine Bestellungen zum Senden', 'error'); return; }
        if (!this.initialize()) return;

        const { fromName, fromEmail } = this._readSettingsForMail();
        const subject = `${CONFIG.subject} – ${fromName}`;

        StatusManager.showLoading(elements.sendOrder, true);
        elements.sendingProgress.classList.remove('hidden');
        StatusManager.showStatus('📤 E-Mail wird gesendet...', 'info');

        try {
            const emailParams = {
                to_email: elements.toEmail.value.trim(),
                from_name: fromName,
                from_email: fromEmail,
                subject,
                message: this.createEmailContent(),
                order_count: String(orders.length),
                total_quantity: String(orders.reduce((sum, order) => sum + order.menge, 0)),
                timestamp: new Date().toLocaleString('de-DE')
            };

            const result = await emailjs.send(
                elements.emailjsService.value.trim(),
                elements.emailjsTemplate.value.trim(),
                emailParams
            );

            if (result.status === 200) {
                StatusManager.showStatus('✅ E-Mail wurde erfolgreich gesendet!', 'success');
                orders = [];
                OrderManager.updateOrderList();
                OrderStorage.saveOrders();
                elements.customMessage.value = '';
                this.closePreview();
            } else {
                throw new Error(`Server antwortete mit Status: ${result.status}`);
            }
        } catch (error) {
            StatusManager.showStatus(error?.message || 'Unbekannter Fehler beim Senden der E-Mail', 'error');
        } finally {
            StatusManager.showLoading(elements.sendOrder, false);
            elements.sendingProgress.classList.add('hidden');
        }
    }

    static async testConnection() {
        if (!this.initialize()) return;

        const { fromName, fromEmail } = this._readSettingsForMail();
        const subject = `Test - QR Scanner Verbindung – ${fromName}`;

        StatusManager.showLoading(elements.testEmailjs, true);
        StatusManager.showStatus('🔧 Teste EmailJS Verbindung...', 'info');

        try {
            const testParams = {
                to_email: elements.toEmail.value.trim(),
                from_name: fromName,
                from_email: fromEmail,
                subject,
                message: 'Dies ist eine Test-E-Mail zur Überprüfung der EmailJS Verbindung.\n\nWenn Sie diese E-Mail erhalten, ist die Verbindung erfolgreich hergestellt.',
                order_count: '0',
                total_quantity: '0',
                timestamp: new Date().toLocaleString('de-DE')
            };

            const result = await emailjs.send(
                elements.emailjsService.value.trim(),
                elements.emailjsTemplate.value.trim(),
                testParams
            );

            if (result.status === 200) {
                StatusManager.showStatus('✅ EmailJS Verbindung erfolgreich! Test-E-Mail wurde gesendet.', 'success');
            } else {
                throw new Error(`Test fehlgeschlagen mit Status: ${result.status}`);
            }
        } catch (error) {
            StatusManager.showStatus(error?.message || 'Test fehlgeschlagen', 'error');
        } finally {
            StatusManager.showLoading(elements.testEmailjs, false);
        }
    }

    static async copyToClipboard() {
        try {
            const content = this.createEmailContent();
            await navigator.clipboard.writeText(content);
            StatusManager.showStatus('📋 Inhalt wurde in die Zwischenablage kopiert!', 'success');
        } catch (error) {
            StatusManager.showStatus('❌ Kopieren fehlgeschlagen', 'error');
        }
    }
}

/* ====== SETTINGS ====== */
class SettingsManager {
    static load() {
        const saved = OrderStorage.loadSettings();

        // EmailJS + Empfänger
        if (saved.toEmail) elements.toEmail.value = saved.toEmail;
        if (saved.emailjsService) elements.emailjsService.value = saved.emailjsService;
        if (saved.emailjsTemplate) elements.emailjsTemplate.value = saved.emailjsTemplate;
        if (saved.emailjsPublic) elements.emailjsPublic.value = saved.emailjsPublic;

        // Personalisierung
        elements.emailSalutation.value = saved.salutation || CONFIG.defaults.salutation;
        elements.senderName.value = saved.senderName || '';
        elements.senderEmail.value = saved.senderEmail || '';
    }

    static save() {
        const settings = {
            // EmailJS
            emailjsService: elements.emailjsService.value.trim(),
            emailjsTemplate: elements.emailjsTemplate.value.trim(),
            emailjsPublic: elements.emailjsPublic.value.trim(),
            toEmail: elements.toEmail.value.trim(),
            // Personalisierung
            salutation: (elements.emailSalutation.value || CONFIG.defaults.salutation).trim(),
            senderName: (elements.senderName.value || '').trim(),
            senderEmail: (elements.senderEmail.value || '').trim()
        };

        if (!this.isValidEmail(settings.toEmail)) {
            StatusManager.showStatus('❌ Bitte eine gültige Empfänger-E-Mail eingeben', 'error');
            return;
        }
        if (!settings.emailjsService || !settings.emailjsTemplate || !settings.emailjsPublic) {
            StatusManager.showStatus('❌ Bitte alle EmailJS Felder ausfüllen', 'error');
            return;
        }
        if (settings.senderEmail && !this.isValidEmail(settings.senderEmail)) {
            StatusManager.showStatus('❌ Bitte eine gültige Absender-E-Mail eingeben oder Feld leer lassen', 'error');
            return;
        }

        OrderStorage.saveSettings(settings);
        StatusManager.showStatus('✅ Einstellungen wurden gespeichert!', 'success');
        emailjsInitialized = false;
        setTimeout(() => { this.closeModal(); }, 800);
    }

    static isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
    static openModal() { elements.settingsModal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    static closeModal() { elements.settingsModal.style.display = 'none'; document.body.style.overflow = ''; }
}

/* ====== EVENTS ====== */
class EventManager {
    static setup() {
        // Einzel-Scan
        elements.scanNow.addEventListener('click', () => QRScanner.singleScan());

        // Foto/Upload scannen
        if (elements.uploadImage) {
            elements.uploadImage.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) Promise.resolve(QRScanner.scanImageFile(file)).finally(() => { e.target.value = ''; });
            });
        }

        // Mengenfeld delegiert
        elements.orderList.addEventListener('change', (e) => {
            const t = e.target;
            if (t && t.classList?.contains('qty-input')) {
                OrderManager.setQuantity(parseInt(t.dataset.index, 10), t.value);
            }
        });
        elements.orderList.addEventListener('input', (e) => {
            const t = e.target;
            if (t && t.classList?.contains('qty-input')) {
                t.value = t.value.replace(/[^\d]/g, '');
            }
        });

        // Order-Buttons
        elements.clearOrders.addEventListener('click', () => OrderManager.clearOrders());

        // E-Mail
        elements.previewEmail.addEventListener('click', () => EmailManager.showPreview());
        elements.sendOrder.addEventListener('click', () => EmailManager.send());
        elements.copyToClipboard.addEventListener('click', () => EmailManager.copyToClipboard());
        elements.closePreview.addEventListener('click', () => EmailManager.closePreview());

        // Settings
        elements.testEmailjs.addEventListener('click', () => EmailManager.testConnection());
        elements.saveSettings.addEventListener('click', () => SettingsManager.save());
        elements.menuToggle.addEventListener('click', () => SettingsManager.openModal());
        elements.closeModal.addEventListener('click', () => SettingsManager.closeModal());
        elements.settingsModal.addEventListener('click', (e) => { if (e.target === elements.settingsModal) SettingsManager.closeModal(); });

        // Tab-Wechsel: Kamera pausieren/fortsetzen
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) QRScanner.stopCamera();
            else QRScanner.startCamera().catch(() => { });
        });
    }
}

/* ====== APP ====== */
class App {
    static async init() {
        validateElements();

        // persistente Bestellungen laden
        orders = OrderStorage.loadOrders();
        OrderManager.updateOrderList();

        // Einstellungen laden
        SettingsManager.load();

        // Events
        EventManager.setup();

        // Kamera automatisch starten (wenn erlaubt, sonst prompt)
        const hadPermission = await QRScanner.hasGrantedPermissionHint();
        if (hadPermission) {
            await QRScanner.startCamera();
        } else {
            await QRScanner.startCamera(); // lässt Browser-Prompt erscheinen
        }

        StatusManager.showStatus('✅ App ist bereit', 'success', 2000);
    }
}

/* ====== GLOBAL ====== */
window.OrderManager = OrderManager;
window.QRScanner = QRScanner;
window.EmailManager = EmailManager;

window.addEventListener('error', (e) => {
    console.error('💥 Globaler Fehler:', e.error);
    StatusManager.showStatus('❌ Ein unerwarteter Fehler ist aufgetreten', 'error');
});
window.addEventListener('unhandledrejection', (e) => {
    const msg = (e && e.reason && (e.reason.message || String(e.reason))) || 'Unbekannter Fehler';
    console.error('💥 Unbehandelter Promise Fehler:', e.reason);
    StatusManager.showStatus(`❌ ${msg}`, 'error');
    e.preventDefault();
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}
