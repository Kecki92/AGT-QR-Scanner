/* ====== KONFIG ====== */
const CONFIG = {
    fromEmail: 'lager9611@gmail.com',
    fromName: 'QR-Code Scanner System',
    subject: 'Neue Bestellung via QR-Scanner',
    storageKeys: {
        orders: 'qrScannerOrders',
        settings: 'qrScannerSettings',
        cameraAllowed: 'qrScannerCameraAllowed'
    }
};

/* ====== STATE & DOM ====== */
let orders = [];
let videoStream = null;
let emailjsInitialized = false;

const $ = (id) => document.getElementById(id);
const el = {
    // Scanner
    scannerContainer: $('scanner-container'),
    qrVideo: $('qr-video'),
    qrCanvas: $('qr-canvas'),
    scanNow: $('scan-now'),
    uploadImage: $('upload-image'),
    scannerStatus: $('scanner-status'),
    // Orders
    orderList: $('order-list'),
    totalArticles: $('total-articles'),
    totalQuantity: $('total-quantity'),
    clearOrders: $('clear-orders'),
    // Mail UI
    customMessage: $('custom-message'),
    emailPreview: $('email-preview'),
    emailPreviewContainer: $('email-preview-container'),
    closePreview: $('close-preview'),
    previewEmail: $('preview-email'),
    sendOrder: $('send-order'),
    copyToClipboard: $('copy-to-clipboard'),
    emailStatus: $('email-status'),
    sendingProgress: $('sending-progress'),
    // Settings
    settingsModal: $('settings-modal'),
    menuToggle: $('menu-toggle'),
    closeModal: $('close-modal'),
    emailjsService: $('emailjs-service'),
    emailjsTemplate: $('emailjs-template'),
    emailjsPublic: $('emailjs-public'),
    toEmail: $('to-email'),
    greeting: $('greeting'),
    signature: $('signature'),
    testEmailjs: $('test-emailjs'),
    saveSettings: $('save-settings')
};

/* ====== UTILS ====== */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const Status = {
    show(msg, type = 'info', t = 3000) { if (!el.emailStatus) return; el.emailStatus.innerHTML = `<div class="status-message ${type}">${msg}</div>`; if (type === 'success' && t > 0) { setTimeout(() => { el.emailStatus.innerHTML = ''; }, t); } },
    scan(msg, type = 'info') { el.scannerStatus.className = `status-message ${type}`; el.scannerStatus.textContent = msg; }
};

/* ====== STORAGE ====== */
const Storage = {
    saveOrders() { try { localStorage.setItem(CONFIG.storageKeys.orders, JSON.stringify(orders)); } catch { } },
    loadOrders() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKeys.orders); if (!raw) return [];
            const p = JSON.parse(raw);
            return Array.isArray(p) ? p.map(o => ({ artikel: String(o.artikel || 'Unbekannter Artikel'), menge: Math.max(1, parseInt(o.menge || 1, 10)), beschreibung: '', id: o.id || Date.now() + Math.random().toString(36).slice(2) })) : [];
        } catch { return []; }
    },
    saveSettings(s) { try { localStorage.setItem(CONFIG.storageKeys.settings, JSON.stringify(s || {})); } catch { } },
    loadSettings() { try { return JSON.parse(localStorage.getItem(CONFIG.storageKeys.settings) || '{}'); } catch { return {}; } },
    setCameraAllowed(v = true) { try { localStorage.setItem(CONFIG.storageKeys.cameraAllowed, v ? '1' : '0'); } catch { } },
    getCameraAllowed() { try { return localStorage.getItem(CONFIG.storageKeys.cameraAllowed) === '1'; } catch { return false; } }
};

/* ====== ORDERS ====== */
const Order = {
    add(article, qty = 1) {
        const i = orders.findIndex(o => o.artikel === article);
        if (i >= 0) orders[i].menge += Math.max(1, qty);
        else orders.push({ artikel: article, menge: Math.max(1, qty), beschreibung: '', id: Date.now() + Math.random().toString(36).slice(2) });
        this.render(); Storage.saveOrders(); Status.scan(`✅ Erfasst: ${article}`, 'success');
    },
    remove(i) { if (i >= 0 && i < orders.length) { orders.splice(i, 1); this.render(); Storage.saveOrders(); } },
    setQty(i, v) {
        if (i < 0 || i >= orders.length) return;
        let x = parseInt(String(v).replace(/[^\d]/g, ''), 10);
        if (Number.isNaN(x) || x < 1) x = 1; if (x > 100000) x = 100000;
        orders[i].menge = x; this.render(); Storage.saveOrders();
    },
    clear() { orders = []; this.render(); Storage.saveOrders(); Status.show('🗑️ Alle Bestellungen wurden gelöscht', 'info', 2000); },
    render() {
        el.totalArticles.textContent = orders.length;
        el.totalQuantity.textContent = orders.reduce((s, o) => s + o.menge, 0);
        if (!orders.length) { el.orderList.innerHTML = '<div class="status-message info">📭 Noch keine Artikel gescannt</div>'; return; }
        el.orderList.innerHTML = orders.map((o, i) => `
      <div class="order-item">
        <div class="order-item-header">
          <div class="order-item-title">${esc(o.artikel)}</div>
          <div class="order-item-quantity">${o.menge}x</div>
        </div>
        <div class="quantity-controls">
          <label class="sr-only" for="qty-${i}">Menge</label>
          <span>Menge:</span>
          <input id="qty-${i}" class="qty-input" type="number" inputmode="numeric" pattern="[0-9]*" min="1" step="1" value="${o.menge}" data-index="${i}" aria-label="Menge für ${esc(o.artikel)}">
          <button class="btn btn-danger quantity-btn" onclick="Order.remove(${i})">🗑️</button>
        </div>
      </div>
    `).join('');
    }
};
window.Order = Order;

/* ====== SCANNER (Einzel-Scan) ====== */
const Scanner = {
    async ensureCamera() {
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') { Status.scan('❌ Kamera-Zugriff erfordert HTTPS oder localhost.', 'error'); return false; }
        if (typeof jsQR === 'undefined') { Status.scan('❌ QR-Bibliothek nicht geladen', 'error'); return false; }
        if (!navigator.mediaDevices?.getUserMedia) { Status.scan('❌ Kamera wird nicht unterstützt', 'error'); return false; }
        try {
            if (!videoStream) {
                Status.scan('📷 Kamera wird gestartet...', 'info');
                videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
                el.qrVideo.srcObject = videoStream;
                await new Promise((res, rej) => { const ready = () => { el.qrVideo.play().then(res).catch(rej); el.qrVideo.removeEventListener('loadedmetadata', ready); }; el.qrVideo.addEventListener('loadedmetadata', ready); if (el.qrVideo.readyState >= 1) ready(); });
                el.scannerContainer.classList.remove('hidden'); Storage.setCameraAllowed(true);
                Status.scan('✅ Kamera bereit – „Jetzt scannen“ drücken', 'success');
            }
            return true;
        } catch (e) { this.handleCameraError(e); return false; }
    },
    async singleScan() {
        const ok = await this.ensureCamera(); if (!ok) return;
        const v = el.qrVideo; if (!v.videoWidth || !v.videoHeight) { Status.scan('⏳ Kamera initialisiert noch…', 'info'); return; }
        const c = el.qrCanvas, ctx = c.getContext('2d', { willReadFrequently: true });
        c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0, c.width, c.height);
        try {
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) this.handle(code.data); else Status.scan('❌ Kein QR-Code im Bild gefunden', 'error');
        } catch (err) { Status.scan(`❌ ${err?.message || err}`, 'error'); }
    },
    async scanImageFile(file) {
        if (!file) return;
        try {
            const url = URL.createObjectURL(file); const img = new Image(); img.crossOrigin = 'anonymous';
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
            const c = el.qrCanvas, ctx = c.getContext('2d', { willReadFrequently: true });
            c.width = img.naturalWidth; c.height = img.naturalHeight; ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height); const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
            URL.revokeObjectURL(url);
            if (code && code.data) this.handle(code.data); else Status.show('❌ In diesem Bild wurde kein QR-Code erkannt', 'error');
        } catch (err) { Status.show(`❌ ${err?.message || err}`, 'error'); }
    },
    handle(data) {
        if (!data || !String(data).trim()) { Status.scan('❌ Ungültiger QR-Code', 'error'); return; }
        try {
            const p = this.parse(data); Order.add(p.artikel, p.menge); Status.scan('🎉 QR-Code erfolgreich gescannt!', 'success');
        } catch { Status.scan('❌ Fehler beim Verarbeiten des QR-Codes', 'error'); }
    },
    parse(data) {
        try {
            const o = JSON.parse(data);
            return { artikel: o.artikel || o.name || o.title || o.product || 'Unbekannter Artikel', menge: Math.max(1, Number(o.menge || o.quantity || o.amount || 1)) };
        } catch { return this.parseText(String(data)); }
    },
    parseText(text) {
        const clean = text.trim(); const lines = clean.split('\n').filter(l => l.trim());
        let artikel = 'Unbekannter Artikel', menge = 1;
        if (lines.length) {
            const parts = [];
            for (const raw of lines) {
                const line = raw.trim();
                if (/^(ALU|GLAS)$/i.test(line)) continue;
                if (/Bestellmenge:/i.test(line)) continue;
                const m = line.match(/(\d+)\s*(STK|Stk|Stück|Stck|PCS)/i); if (m) { menge = parseInt(m[1], 10); continue; }
                if (line && !/^\d/.test(line)) parts.push(line);
            }
            artikel = parts.join(' ').trim() || artikel;
            if (menge === 1) {
                const nums = clean.match(/\b\d+\b/g);
                if (nums) { const c = nums.map(n => parseInt(n, 10)).filter(n => n > 1 && n < 10000); if (c.length) menge = Math.max(...c); }
            }
        }
        artikel = artikel.replace(/^ALU\s*-?\s*/i, '').replace(/^GLAS\s*-?\s*/i, '').replace(/\s*Bestellmenge:.*$/i, '').replace(/\s*\d+\s*(STK|Stück).*$/i, '').trim().substring(0, 100);
        return { artikel: artikel || 'Unbekannter Artikel', menge: Math.max(1, menge) };
    },
    handleCameraError(e) {
        let msg = 'Kamera-Fehler.';
        if (e?.name === 'NotAllowedError') msg = '❌ Kamera-Zugriff verweigert. Bitte im Browser erlauben.';
        else if (e?.name === 'NotFoundError') msg = '❌ Keine Kamera gefunden.';
        else if (e?.name === 'NotReadableError') msg = '❌ Kamera wird bereits verwendet.';
        else msg = `❌ ${e?.message || 'Unbekannter Fehler'}`;
        Status.scan(msg, 'error');
    }
};
window.Scanner = Scanner;

/* ====== E-MAIL ====== */
const Email = {
    initialize() {
        try {
            const s = Settings.get();
            if (!s.emailjsService || !s.emailjsTemplate || !s.emailjsPublic || !s.toEmail) throw new Error('Bitte alle E-Mail Felder ausfüllen.');
            if (typeof emailjs === 'undefined') throw new Error('EmailJS SDK konnte nicht geladen werden');
            if (!emailjsInitialized) { emailjs.init(s.emailjsPublic); emailjsInitialized = true; }
            return true;
        } catch (e) { Status.show(e.message, 'error'); return false; }
    },

    // *** GENAU DEIN WUNSCHFORMAT ***
    buildContent() {
        if (!orders.length) throw new Error('Keine Bestellungen vorhanden');
        const s = Settings.get();
        const greet = (s.greeting || '').trim();
        const sign = (s.signature || '').trim();

        // TEXT-Version
        let text = '';
        if (greet) text += greet + '\n\n';
        orders.forEach((o, i) => { text += `${i + 1}. ${o.artikel} – ${o.menge}\n`; });
        text += `\nZusammenfassung:\n\t- Gesamtanzahl der Artikel: ${orders.length}\n`;
        if (sign) text += `\n${sign}\n`;

        // HTML-Version für Vorschau
        const htmlItems = orders.map((o, i) => `<div class="item"><strong>${i + 1}. ${esc(o.artikel)} – ${o.menge}</strong></div>`).join('');
        const html = `
      <div class="mail">
        ${greet ? `<div class="line">${esc(greet)}</div>` : ''}
        ${htmlItems}
        <div class="line" style="margin-top:.8rem">
          <strong>Zusammenfassung:</strong><br>
          &nbsp;&nbsp;- Gesamtanzahl der Artikel: ${orders.length}
        </div>
        ${sign ? `<div class="line"><strong>${esc(sign)}</strong></div>` : ''}
      </div>`;

        return { text, html, to: s.toEmail };
    },

    showPreview() {
        try { const { html } = this.buildContent(); el.emailPreview.innerHTML = html; el.emailPreviewContainer.classList.remove('hidden'); Status.show('📧 E-Mail Vorschau wurde generiert', 'success'); }
        catch (e) { Status.show(e.message, 'error'); }
    },

    async send() {
        if (!orders.length) { Status.show('❌ Keine Bestellungen zum Senden', 'error'); return; }
        if (!this.initialize()) return;

        Status.show('📤 E-Mail wird gesendet …', 'info');
        el.sendingProgress.classList.remove('hidden');

        try {
            const { text, html, to } = this.buildContent();
            const r = await emailjs.send(
                el.emailjsService.value.trim(),
                el.emailjsTemplate.value.trim(),
                {
                    to_email: to,
                    from_name: CONFIG.fromName,
                    from_email: CONFIG.fromEmail,
                    subject: CONFIG.subject,
                    message: text,           // Text
                    message_text: text,
                    message_html: html,      // HTML
                    order_count: String(orders.length),
                    total_quantity: String(orders.reduce((s, o) => s + o.menge, 0)),
                    timestamp: new Date().toLocaleString('de-DE'),
                    greeting: el.greeting.value.trim(),
                    signature: el.signature.value.trim()
                }
            );

            if (r.status === 200) {
                Status.show('✅ E-Mail wurde erfolgreich gesendet!', 'success');
                orders = []; Order.render(); Storage.saveOrders();
                el.customMessage.value = ''; el.emailPreviewContainer.classList.add('hidden');
            } else { throw new Error(`Server antwortete mit Status: ${r.status}`); }
        } catch (e) { Status.show('❌ ' + (e?.text || e?.message || 'Fehler beim Senden'), 'error'); }
        finally { el.sendingProgress.classList.add('hidden'); }
    },

    async copy() {
        try { const { text } = this.buildContent(); await navigator.clipboard.writeText(text); Status.show('📋 Inhalt kopiert!', 'success'); }
        catch { Status.show('❌ Kopieren fehlgeschlagen', 'error'); }
    },

    async testConnection() {
        if (!this.initialize()) return;
        Status.show('🔧 Teste EmailJS Verbindung …', 'info');
        try {
            const r = await emailjs.send(
                el.emailjsService.value.trim(),
                el.emailjsTemplate.value.trim(),
                { to_email: el.toEmail.value.trim(), from_name: CONFIG.fromName, from_email: CONFIG.fromEmail, subject: 'Test', message: 'Test', message_text: 'Test', message_html: '<strong>Test</strong>' }
            );
            if (r.status === 200) Status.show('✅ EmailJS Verbindung erfolgreich!', 'success');
            else throw new Error(`Test fehlgeschlagen (${r.status})`);
        } catch (e) { Status.show('❌ ' + (e?.text || e?.message), 'error'); }
    }
};
window.Email = Email;

/* ====== SETTINGS ====== */
const Settings = {
    get() {
        return {
            emailjsService: el.emailjsService.value.trim(),
            emailjsTemplate: el.emailjsTemplate.value.trim(),
            emailjsPublic: el.emailjsPublic.value.trim(),
            toEmail: el.toEmail.value.trim(),
            greeting: el.greeting.value.trim(),
            signature: el.signature.value.trim()
        };
    },
    load() {
        const s = Storage.loadSettings();
        if (s.toEmail) el.toEmail.value = s.toEmail;
        if (s.emailjsService) el.emailjsService.value = s.emailjsService;
        if (s.emailjsTemplate) el.emailjsTemplate.value = s.emailjsTemplate;
        if (s.emailjsPublic) el.emailjsPublic.value = s.emailjsPublic;
        if (s.greeting) el.greeting.value = s.greeting;
        if (s.signature) el.signature.value = s.signature;
    },
    save() {
        const s = this.get();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.toEmail)) { Status.show('❌ Bitte gültige Empfänger-E-Mail eingeben', 'error'); return; }
        if (!s.emailjsService || !s.emailjsTemplate || !s.emailjsPublic) { Status.show('❌ Bitte alle EmailJS-Felder ausfüllen', 'error'); return; }
        Storage.saveSettings(s); Status.show('✅ Einstellungen gespeichert', 'success'); emailjsInitialized = false;
        setTimeout(() => this.close(), 500);
    },
    open() { el.settingsModal.style.display = 'flex'; document.body.style.overflow = 'hidden'; },
    close() { el.settingsModal.style.display = 'none'; document.body.style.overflow = ''; }
};
window.Settings = Settings;

/* ====== EVENTS ====== */
const Events = {
    bind() {
        // Scan
        el.scanNow.addEventListener('click', () => Scanner.singleScan());
        el.uploadImage.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) Scanner.scanImageFile(f).finally(() => { e.target.value = ''; }); });

        // Menge Eingabe
        el.orderList.addEventListener('input', (e) => {
            if (e.target && e.target.classList.contains('qty-input')) {
                const idx = parseInt(e.target.dataset.index, 10);
                const raw = String(e.target.value || '').replace(/[^\d]/g, ''); e.target.value = raw;
                if (raw !== '') Order.setQty(idx, raw);
            }
        });
        el.orderList.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('qty-input')) {
                const idx = parseInt(e.target.dataset.index, 10); Order.setQty(idx, e.target.value);
            }
        });

        // Orders
        el.clearOrders.addEventListener('click', () => Order.clear());

        // Mail
        el.previewEmail.addEventListener('click', () => Email.showPreview());
        el.sendOrder.addEventListener('click', () => Email.send());
        el.copyToClipboard.addEventListener('click', () => Email.copy());
        el.closePreview.addEventListener('click', () => el.emailPreviewContainer.classList.add('hidden'));

        // Settings
        el.menuToggle.addEventListener('click', () => Settings.open());
        el.closeModal.addEventListener('click', () => Settings.close());
        el.settingsModal.addEventListener('click', (e) => { if (e.target === el.settingsModal) Settings.close(); });
        el.saveSettings.addEventListener('click', () => Settings.save());
        if (el.testEmailjs) el.testEmailjs.addEventListener('click', () => Email.testConnection());

        // Tabwechsel → Kamera stoppen
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                try { if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; el.qrVideo.srcObject = null; } } catch { }
            }
        });

        // Fehler
        window.addEventListener('error', (e) => { console.error(e); Status.show('❌ Ein unerwarteter Fehler ist aufgetreten', 'error'); });
        window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); Status.show(`❌ ${(e?.reason?.message) || 'Fehler bei asynchroner Operation'}`, 'error'); e.preventDefault(); });
    }
};

/* ====== APP ====== */
class App {
    static async init() {
        try {
            orders = Storage.loadOrders();
            Order.render();
            Settings.load();
            Events.bind();

            if (Storage.getCameraAllowed()) { Scanner.ensureCamera().catch(() => { }); }

            Status.show('✅ App ist bereit', 'success', 1500);
        } catch (e) { Status.show(`❌ Initialisierungsfehler: ${e.message}`, 'error'); }
    }
}

/* ====== START ====== */
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => App.init()); }
else { App.init(); }
