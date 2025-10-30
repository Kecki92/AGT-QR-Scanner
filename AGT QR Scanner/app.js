/* ====== APP KONFIGURATION ====== */
const CONFIG = {
    fromEmail: 'lager9611@gmail.com',
    fromName: 'QR-Code Scanner System',
    subject: 'Neue Bestellung via QR-Scanner',
    scanner: {
        autoScan: false // nur Einzel-Scan über Button
    },
    storageKeys: {
        orders: 'qrScannerOrders',
        cameraAllowed: 'qrScannerCameraAllowed',
        settings: 'qrScannerSettings'
    }
};

/* ====== STATE ====== */
let orders = [];
let videoStream = null;
let emailjsInitialized = false;

/* ====== DOM ====== */
const el = (id) => document.getElementById(id);
const elements = {
    scannerContainer: el('scanner-container'),
    qrVideo: el('qr-video'),
    qrCanvas: el('qr-canvas'),
    uploadImage: el('upload-image'),
    scanNow: el('scan-now'),
    scannerStatus: el('scanner-status'),

    orderList: el('order-list'),
    totalArticles: el('total-articles'),
    totalQuantity: el('total-quantity'),
    clearOrders: el('clear-orders'),

    customMessage: el('custom-message'),
    emailPreview: el('email-preview'),
    emailPreviewContainer: el('email-preview-container'),
    closePreview: el('close-preview'),
    previewEmail: el('preview-email'),
    sendOrder: el('send-order'),
    copyToClipboard: el('copy-to-clipboard'),
    emailStatus: el('email-status'),
    sendingProgress: el('sending-progress'),

    settingsModal: el('settings-modal'),
    menuToggle: el('menu-toggle'),
    closeModal: el('close-modal'),
    emailjsService: el('emailjs-service'),
    emailjsTemplate: el('emailjs-template'),
    emailjsPublic: el('emailjs-public'),
    toEmail: el('to-email'),
    greeting: el('greeting'),
    senderName: el('sender-name'),
    signature: el('signature'),
    testEmailjs: el('test-emailjs'),
    saveSettings: el('save-settings')
};

/* ====== UTIL ====== */
const escapeHtml = (s) =>
    String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

class Status {
    static show(message, type = 'info', duration = 3000) {
        const box = elements.emailStatus; if (!box) return;
        box.innerHTML = `<div class="status-message ${type}">${message}</div>`;
        if (type === 'success' && duration > 0) {
            setTimeout(() => { if (box.textContent.includes(message)) box.innerHTML = ''; }, duration);
        }
    }
    static scan(message, type = 'info') {
        const s = elements.scannerStatus; if (!s) return;
        s.className = `status-message ${type}`;
        s.textContent = message;
    }
}

/* ====== STORAGE ====== */
const Storage = {
    saveOrders() { try { localStorage.setItem(CONFIG.storageKeys.orders, JSON.stringify(orders)); } catch { } },
    loadOrders() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKeys.orders); if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.map(o => ({
                artikel: String(o.artikel || 'Unbekannter Artikel'),
                menge: Math.max(1, parseInt(o.menge || 1, 10)),
                beschreibung: String(o.beschreibung || ''),
                id: o.id || Date.now() + Math.random().toString(36).slice(2)
            })) : [];
        } catch { return []; }
    },
    setCameraAllowed(v = true) { try { localStorage.setItem(CONFIG.storageKeys.cameraAllowed, v ? '1' : '0'); } catch { } },
    getCameraAllowed() { try { return localStorage.getItem(CONFIG.storageKeys.cameraAllowed) === '1'; } catch { return false; } },
    saveSettings(obj) { try { localStorage.setItem(CONFIG.storageKeys.settings, JSON.stringify(obj || {})); } catch { } },
    loadSettings() { try { return JSON.parse(localStorage.getItem(CONFIG.storageKeys.settings) || '{}'); } catch { return {}; } }
};

/* ====== ORDERS ====== */
const Order = {
    add(article, quantity = 1, description = '') {
        const existing = orders.findIndex(o => o.artikel === article && o.beschreibung === description);
        if (existing >= 0) orders[existing].menge += Math.max(1, quantity);
        else orders.push({ artikel: article, menge: Math.max(1, quantity), beschreibung: description, id: Date.now() + Math.random().toString(36).slice(2) });
        this.render(); Storage.saveOrders();
        Status.scan(`✅ Erfasst: ${article}`, 'success');
    },
    remove(idx) { if (idx >= 0 && idx < orders.length) { orders.splice(idx, 1); this.render(); Storage.saveOrders(); } },
    setQty(idx, val) {
        if (idx < 0 || idx >= orders.length) return;
        let v = parseInt(String(val).replace(/[^\d]/g, ''), 10);
        if (Number.isNaN(v) || v < 1) v = 1; if (v > 100000) v = 100000;
        orders[idx].menge = v; this.render(); Storage.saveOrders();
    },
    clear() { orders = []; this.render(); Storage.saveOrders(); Status.show('🗑️ Alle Bestellungen wurden gelöscht', 'info', 2000); },
    render() {
        const list = elements.orderList;
        elements.totalArticles.textContent = orders.length;
        elements.totalQuantity.textContent = orders.reduce((s, o) => s + o.menge, 0);
        if (orders.length === 0) { list.innerHTML = '<div class="status-message info">📭 Noch keine Artikel gescannt</div>'; return; }
        list.innerHTML = orders.map((o, i) => `
      <div class="order-item">
        <div class="order-item-header">
          <div class="order-item-title">${escapeHtml(o.artikel)}</div>
          <div class="order-item-quantity">${o.menge}x</div>
        </div>
        ${o.beschreibung ? `<div class="order-item-details">${escapeHtml(o.beschreibung)}</div>` : ''}
        <div class="quantity-controls">
          <label class="sr-only" for="qty-${i}">Menge</label>
          <span>Menge:</span>
          <input id="qty-${i}" class="qty-input" type="number" inputmode="numeric" pattern="[0-9]*"
            min="1" step="1" value="${o.menge}" data-index="${i}" aria-label="Menge für ${escapeHtml(o.artikel)}" />
          <button class="btn btn-danger quantity-btn" onclick="Order.remove(${i})">🗑️</button>
        </div>
      </div>
    `).join('');
    }
};
window.Order = Order;

/* ====== SCANNER (nur Einzel-Scan) ====== */
const Scanner = {
    async ensureCamera() {
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            Status.scan('❌ Kamera-Zugriff erfordert HTTPS oder localhost.', 'error'); return false;
        }
        if (typeof jsQR === 'undefined') { Status.scan('❌ QR-Bibliothek nicht geladen', 'error'); return false; }
        if (!navigator.mediaDevices?.getUserMedia) { Status.scan('❌ Kamera wird nicht unterstützt', 'error'); return false; }

        try {
            if (!videoStream) {
                Status.scan('📷 Kamera wird gestartet...', 'info');
                videoStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
                });
                const video = elements.qrVideo;
                video.srcObject = videoStream;
                await new Promise((res, rej) => {
                    const ready = () => { video.play().then(res).catch(rej); video.removeEventListener('loadedmetadata', ready); };
                    video.addEventListener('loadedmetadata', ready);
                    if (video.readyState >= 1) ready();
                });
                elements.scannerContainer.classList.remove('hidden');
                Storage.setCameraAllowed(true);
                Status.scan('✅ Kamera bereit – „Jetzt scannen“ drücken', 'success');
            }
            return true;
        } catch (e) {
            this.handleCameraError(e); return false;
        }
    },

    async singleScan() {
        const ok = await this.ensureCamera(); if (!ok) return;
        const v = elements.qrVideo; if (!v.videoWidth || !v.videoHeight) { Status.scan('⏳ Kamera initialisiert noch…', 'info'); return; }

        const c = elements.qrCanvas;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        c.width = v.videoWidth; c.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, c.width, c.height);

        try {
            const data = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) this.handle(code.data);
            else Status.scan('❌ Kein QR-Code im Bild gefunden', 'error');
        } catch (err) {
            console.error(err); Status.scan(`❌ ${err?.message || err}`, 'error');
        }
    },

    async scanImageFile(file) {
        if (!file) return;
        try {
            const url = URL.createObjectURL(file);
            const img = new Image(); img.crossOrigin = 'anonymous';
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
            const c = elements.qrCanvas, ctx = c.getContext('2d', { willReadFrequently: true });
            c.width = img.naturalWidth; c.height = img.naturalHeight; ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
            URL.revokeObjectURL(url);
            if (code && code.data) this.handle(code.data);
            else Status.show('❌ In diesem Bild wurde kein QR-Code erkannt', 'error');
        } catch (err) {
            console.error(err); Status.show(`❌ ${err?.message || err}`, 'error');
        }
    },

    handle(data) {
        if (!data || !String(data).trim()) { Status.scan('❌ Ungültiger QR-Code', 'error'); return; }
        try {
            const parsed = this.parse(data);
            Order.add(parsed.artikel, parsed.menge, parsed.beschreibung);
            Status.scan('🎉 QR-Code erfolgreich gescannt!', 'success');
        } catch (e) {
            console.error(e); Status.scan('❌ Fehler beim Verarbeiten des QR-Codes', 'error');
        }
    },

    parse(data) {
        try {
            const o = JSON.parse(data);
            return {
                artikel: o.artikel || o.name || o.title || o.product || 'Unbekannter Artikel',
                menge: Math.max(1, Number(o.menge || o.quantity || o.amount || 1)),
                beschreibung: o.beschreibung || o.description || o.details || ''
            };
        } catch {
            return this.parseText(String(data));
        }
    },

    parseText(text) {
        const clean = text.trim(); const lines = clean.split('\n').filter(l => l.trim());
        let artikel = 'Unbekannter Artikel', menge = 1, beschreibung = '';

        if (lines.length) {
            const artikelLines = [];
            for (const raw of lines) {
                const line = raw.trim();
                if (/^(\s*ALU|\s*GLAS)\s*$/i.test(line)) continue;
                if (/Bestellmenge:/i.test(line)) continue;

                const m = line.match(/(\d+)\s*(STK|Stk|Stück|Stck|PCS)/i);
                if (m) { menge = parseInt(m[1], 10); continue; }

                if (line && !/^\d/.test(line)) artikelLines.push(line);
            }
            artikel = artikelLines.join(' ').trim() || artikel;

            if (menge === 1) {
                const nums = clean.match(/\b\d+\b/g);
                if (nums) {
                    const cand = nums.map(n => parseInt(n, 10)).filter(n => n > 1 && n < 10000);
                    if (cand.length) menge = Math.max(...cand);
                }
            }

            const tech = lines.filter(l =>
                /ISO\s*\d+/i.test(l) || /[A-ZÄÖÜ]+[\s-]*\d+[xX]\d+/.test(l) || /[A-Za-zÄÖÜäöü]+\s*[A-Za-zÄÖÜäöü]*\s*\d+/.test(l)
            );
            if (tech.length) beschreibung = tech.join(', ');
        }

        artikel = artikel
            .replace(/^ALU\s*-?\s*/i, '').replace(/^GLAS\s*-?\s*/i, '')
            .replace(/\s*Bestellmenge:.*$/i, '').replace(/\s*\d+\s*(STK|Stk|Stück).*$/i, '')
            .trim().substring(0, 100);

        return { artikel: artikel || 'Unbekannter Artikel', menge: Math.max(1, menge), beschreibung };
    },

    handleCameraError(error) {
        let msg = 'Kamera-Fehler.';
        const n = error?.name, m = error?.message;
        if (n === 'NotAllowedError') msg = '❌ Kamera-Zugriff verweigert. Bitte im Browser erlauben.';
        else if (n === 'NotFoundError') msg = '❌ Keine Kamera gefunden.';
        else if (n === 'NotSupportedError') msg = '❌ Kamera wird nicht unterstützt.';
        else if (n === 'NotReadableError') msg = '❌ Kamera wird bereits verwendet.';
        else msg = `❌ ${m || 'Unbekannter Fehler'}`;
        Status.scan(msg, 'error');
    }
};
window.Scanner = Scanner;

/* ====== EMAIL ====== */
const Email = {
    initialize() {
        try {
            const serviceId = elements.emailjsService.value.trim();
            const templateId = elements.emailjsTemplate.value.trim();
            const publicKey = elements.emailjsPublic.value.trim();
            const toEmail = elements.toEmail.value.trim();
            if (!serviceId || !templateId || !publicKey || !toEmail) throw new Error('Bitte alle E-Mail Felder ausfüllen.');
            if (typeof emailjs === 'undefined') throw new Error('EmailJS SDK konnte nicht geladen werden');
            if (!emailjsInitialized) { emailjs.init(publicKey); emailjsInitialized = true; }
            return true;
        } catch (e) { Status.show(e.message, 'error'); return false; }
    },

    buildContent() {
        if (orders.length === 0) throw new Error('Keine Bestellungen vorhanden');

        const settings = Settings.get();
        const greet = (settings.greeting || '').trim();
        const sender = (settings.senderName || '').trim();
        const signature = (settings.signature || '').trim();
        const custom = elements.customMessage.value.trim();

        // TEXT
        let text = '';
        if (greet) text += `${greet}\n\n`;
        text += `hiermit bestelle ich folgende Artikel:\n\n`;
        orders.forEach((o, i) => {
            text += `${i + 1}. ${o.artikel} – ${o.menge} Stück\n`;
            if (o.beschreibung) text += `   Beschreibung: ${o.beschreibung}\n`;
        });
        const totalArticles = orders.length;
        const totalQty = orders.reduce((s, o) => s + o.menge, 0);
        text += `\nZusammenfassung:\n- Artikel: ${totalArticles}\n- Gesamtmenge: ${totalQty} Stück\n\n`;
        if (custom) text += `${custom}\n\n`;
        text += `Mit freundlichen Grüßen\n`;
        if (sender) text += `${sender}\n`;
        text += `${CONFIG.fromName}\n${CONFIG.fromEmail}\n`;
        if (signature) text += `\n${signature}\n`;
        text += `\n---\nGesendet via QR-Scanner App | ${new Date().toLocaleString('de-DE')}`;

        // HTML
        const htmlItems = orders.map((o) => `
      <div class="item">
        <div><span class="item-title">${escapeHtml(o.artikel)}</span> <span class="qty">${o.menge}x</span></div>
        ${o.beschreibung ? `<div class="line">${escapeHtml(o.beschreibung)}</div>` : ``}
      </div>
    `).join('');
        const html =
            `<div class="mail">
  ${greet ? `<div class="line">${escapeHtml(greet)}</div>` : ``}
  <div class="line">hiermit bestelle ich folgende Artikel:</div>
  <div style="margin:.5rem 0 0 0"></div>
  ${htmlItems}
  <div class="line" style="margin-top:.6rem"><strong>Zusammenfassung</strong></div>
  <div class="line">• Artikel: <strong>${totalArticles}</strong></div>
  <div class="line">• Gesamtmenge: <strong>${totalQty}</strong></div>
  ${custom ? `<div class="line" style="margin-top:.6rem">${escapeHtml(custom)}</div>` : ``}
  <div class="line" style="margin-top:1rem">Mit freundlichen Grüßen</div>
  ${sender ? `<div class="line"><strong>${escapeHtml(sender)}</strong></div>` : ``}
  <div class="line">${escapeHtml(CONFIG.fromName)}</div>
  <div class="line">${escapeHtml(CONFIG.fromEmail)}</div>
  ${signature ? `<div class="line" style="margin-top:.6rem">${escapeHtml(signature)}</div>` : ``}
  <div class="line" style="margin-top:1rem;color:#94a3b8">— Gesendet via QR-Scanner App | ${escapeHtml(new Date().toLocaleString('de-DE'))}</div>
</div>`;
        return { text, html };
    },

    showPreview() {
        try {
            const { html } = this.buildContent();
            elements.emailPreview.innerHTML = `
        <style>.email-preview .item-title{font-weight:800}</style>
        ${html}
      `;
            elements.emailPreviewContainer.classList.remove('hidden');
            Status.show('📧 E-Mail Vorschau wurde generiert', 'success');
        } catch (e) { Status.show(e.message, 'error'); }
    },

    async send() {
        if (orders.length === 0) { Status.show('❌ Keine Bestellungen zum Senden', 'error'); return; }
        if (!this.initialize()) return;

        Status.show('📤 E-Mail wird gesendet...', 'info');
        elements.sendingProgress.classList.remove('hidden');

        try {
            const content = this.buildContent();
            const params = {
                to_email: elements.toEmail.value.trim(),
                from_name: CONFIG.fromName,
                from_email: CONFIG.fromEmail,
                subject: CONFIG.subject,
                message: content.text,       // Plaintext (Kompatibilität)
                message_text: content.text,  // explizit
                message_html: content.html,  // HTML
                order_count: String(orders.length),
                total_quantity: String(orders.reduce((s, o) => s + o.menge, 0)),
                timestamp: new Date().toLocaleString('de-DE'),
                greeting: (Settings.get().greeting || ''),
                sender_name: (Settings.get().senderName || ''),
                signature: (Settings.get().signature || '')
            };

            const result = await emailjs.send(
                elements.emailjsService.value.trim(),
                elements.emailjsTemplate.value.trim(),
                params
            );

            if (result.status === 200) {
                Status.show('✅ E-Mail wurde erfolgreich gesendet!', 'success');
                orders = []; Order.render(); Storage.saveOrders();
                elements.customMessage.value = ''; elements.emailPreviewContainer.classList.add('hidden');
            } else {
                throw new Error(`Server antwortete mit Status: ${result.status}`);
            }
        } catch (e) {
            Status.show('❌ ' + (e?.text || e?.message || 'Unbekannter Fehler beim Senden'), 'error');
        } finally {
            elements.sendingProgress.classList.add('hidden');
        }
    },

    async copy() {
        try {
            const { text } = this.buildContent();
            await navigator.clipboard.writeText(text);
            Status.show('📋 Inhalt wurde in die Zwischenablage kopiert!', 'success');
        } catch (e) { Status.show('❌ Kopieren fehlgeschlagen', 'error'); }
    },

    async testConnection() {
        if (!this.initialize()) return;
        Status.show('🔧 Teste EmailJS Verbindung...', 'info');
        try {
            const result = await emailjs.send(
                elements.emailjsService.value.trim(),
                elements.emailjsTemplate.value.trim(),
                {
                    to_email: elements.toEmail.value.trim(),
                    from_name: CONFIG.fromName,
                    from_email: CONFIG.fromEmail,
                    subject: 'Test - QR Scanner Verbindung',
                    message: 'Dies ist eine Test-E-Mail zur Überprüfung der EmailJS Verbindung.',
                    message_text: 'Test',
                    message_html: '<strong>Test</strong>',
                    order_count: '0', total_quantity: '0', timestamp: new Date().toLocaleString('de-DE')
                }
            );
            if (result.status === 200) Status.show('✅ EmailJS Verbindung erfolgreich!', 'success');
            else throw new Error(`Test fehlgeschlagen (${result.status})`);
        } catch (e) { Status.show('❌ ' + (e?.text || e?.message), 'error'); }
    }
};
window.Email = Email;

/* ====== SETTINGS ====== */
const Settings = {
    get() {
        return {
            emailjsService: elements.emailjsService.value.trim(),
            emailjsTemplate: elements.emailjsTemplate.value.trim(),
            emailjsPublic: elements.emailjsPublic.value.trim(),
            toEmail: elements.toEmail.value.trim(),
            greeting: elements.greeting.value.trim(),
            senderName: elements.senderName.value.trim(),
            signature: elements.signature.value.trim()
        };
    },
    load() {
        const s = Storage.loadSettings();
        if (s.toEmail) elements.toEmail.value = s.toEmail;
        if (s.emailjsService) elements.emailjsService.value = s.emailjsService;
        if (s.emailjsTemplate) elements.emailjsTemplate.value = s.emailjsTemplate;
        if (s.emailjsPublic) elements.emailjsPublic.value = s.emailjsPublic;
        if (s.greeting) elements.greeting.value = s.greeting;
        if (s.senderName) elements.senderName.value = s.senderName;
        if (s.signature) elements.signature.value = s.signature;
    },
    save() {
        const s = this.get();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.toEmail)) {
            Status.show('❌ Bitte eine gültige E-Mail-Adresse eingeben', 'error'); return;
        }
        if (!s.emailjsService || !s.emailjsTemplate || !s.emailjsPublic) {
            Status.show('❌ Bitte alle EmailJS Felder ausfüllen', 'error'); return;
        }
        Storage.saveSettings(s);
        Status.show('✅ Einstellungen wurden gespeichert!', 'success');
        emailjsInitialized = false;
        setTimeout(() => { try { elements.settingsModal.style.display = 'none'; document.body.style.overflow = ''; } catch { } }, 600);
    },
    open() { elements.settingsModal.style.display = 'flex'; document.body.style.overflow = 'hidden'; },
    close() { elements.settingsModal.style.display = 'none'; document.body.style.overflow = ''; }
};
window.Settings = Settings;

/* ====== EVENTS ====== */
const Events = {
    bind() {
        // Kamera & Scan
        elements.scanNow.addEventListener('click', () => Scanner.singleScan());
        elements.uploadImage.addEventListener('change', (e) => {
            const file = e.target.files?.[0]; if (file) Scanner.scanImageFile(file).finally(() => { e.target.value = ''; });
        });

        // Mengeingabe (Delegation)
        elements.orderList.addEventListener('input', (e) => {
            if (e.target && e.target.classList.contains('qty-input')) {
                const idx = parseInt(e.target.dataset.index, 10);
                const raw = String(e.target.value || '').replace(/[^\d]/g, '');
                e.target.value = raw; if (raw !== '') Order.setQty(idx, raw);
            }
        });
        elements.orderList.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('qty-input')) {
                const idx = parseInt(e.target.dataset.index, 10);
                Order.setQty(idx, e.target.value);
            }
        });

        // Bestellungen
        elements.clearOrders.addEventListener('click', () => Order.clear());

        // E-Mail
        elements.previewEmail.addEventListener('click', () => Email.showPreview());
        elements.sendOrder.addEventListener('click', () => Email.send());
        elements.copyToClipboard.addEventListener('click', () => Email.copy());
        elements.closePreview.addEventListener('click', () => elements.emailPreviewContainer.classList.add('hidden'));

        // Einstellungen
        elements.menuToggle.addEventListener('click', () => Settings.open());
        elements.closeModal.addEventListener('click', () => Settings.close());
        elements.settingsModal.addEventListener('click', (e) => { if (e.target === elements.settingsModal) Settings.close(); });
        elements.saveSettings.addEventListener('click', () => Settings.save());
        if (elements.testEmailjs) elements.testEmailjs.addEventListener('click', () => Email.testConnection());

        // Tab-Wechsel: Kamera stoppen (Akkuschonend)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                try { if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; elements.qrVideo.srcObject = null; } } catch { }
            }
        });

        // Global error handlers
        window.addEventListener('error', (e) => {
            console.error('💥 Globaler Fehler:', e.error);
            Status.show('❌ Ein unerwarteter Fehler ist aufgetreten', 'error');
        });
        window.addEventListener('unhandledrejection', (e) => {
            console.error('💥 Unbehandelter Promise Fehler:', e.reason);
            Status.show(`❌ ${(e?.reason?.message) || 'Fehler bei asynchroner Operation'}`, 'error');
            e.preventDefault();
        });
    }
};

/* ====== APP ====== */
class App {
    static async init() {
        try {
            // Daten laden
            orders = Storage.loadOrders();
            Order.render();

            // Einstellungen laden
            Settings.load();

            // Events binden
            Events.bind();

            // Kamera vorbereiten (falls schon erlaubt)
            if (Storage.getCameraAllowed()) {
                Scanner.ensureCamera().catch(() => { });
            }

            Status.show('✅ App ist bereit', 'success', 2000);
        } catch (e) {
            console.error(e);
            Status.show(`❌ Initialisierungsfehler: ${e.message}`, 'error');
        }
    }
}

/* ====== START ====== */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}
