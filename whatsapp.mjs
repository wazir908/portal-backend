import makeWASocket, { Browsers, DisconnectReason } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function createWhatsApp(store, messageDelay = 3000, socketFactory = makeWASocket) {
  let socket, retryTimer, stopped = false, generation = 0, retries = 0;
  let connection = { state: 'offline', qrDataUrl: '', account: null, error: '' };
  let batch = store.latestBatch();
  // Never replay a message whose delivery became uncertain during a restart.
  if (batch && ['queued', 'sending'].includes(batch.state)) {
    batch.state = 'cancelled';
    for (const item of batch.items) if (['queued', 'sending'].includes(item.status)) {
      item.error = item.status === 'sending' ? 'Server restarted during send; check WhatsApp before retrying.' : 'Server restarted before sending.';
      item.status = 'cancelled';
    }
    store.saveBatch(batch);
  }
  const snapshot = () => ({ connection, batch });
  async function connect() {
    if (socket || retryTimer) return snapshot();
    stopped = false;
    const current = ++generation;
    connection = { state: 'connecting', qrDataUrl: '', account: null, error: '' };
    const { state, saveCreds } = store.auth();
    let client;
    try {
      client = socketFactory({ auth: state, logger: pino({ level: 'silent' }), browser: Browsers.ubuntu('Chrome'), syncFullHistory: false, markOnlineOnConnect: false });
    } catch (error) {
      connection.state = 'error'; connection.error = 'Could not start WhatsApp connection. Try linking again.';
      throw error;
    }
    socket = client;
    client.ev.on('creds.update', () => { if (current === generation) void saveCreds().catch(() => { connection.error = 'Failed to save WhatsApp credentials.'; }); });
    client.ev.on('connection.update', async update => {
      if (current !== generation) return;
      if (update.qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(update.qr, { width: 280, margin: 2 });
          if (current === generation && socket === client && connection.state !== 'ready') connection = { state: 'qr', qrDataUrl, account: null, error: '' };
        } catch { connection.error = 'Could not generate linking QR. Try again.'; }
      }
      if (update.connection === 'open') {
        retries = 0;
        connection = { state: 'ready', qrDataUrl: '', account: { name: client.user?.name || 'WhatsApp', phone: client.user?.id?.split(':')[0]?.split('@')[0] || '' }, error: '' };
      }
      if (update.connection === 'close') {
        socket = null;
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        connection = { state: loggedOut ? 'offline' : 'connecting', qrDataUrl: '', account: null, error: loggedOut ? 'Device was logged out. Click Link WhatsApp to scan again.' : 'Connection interrupted; reconnecting.' };
        if (loggedOut) { stopped = true; store.clearAuth(); }
        if (!stopped && retries++ < 8) {
          retryTimer = setTimeout(() => { retryTimer = null; void connect().catch(() => { connection.state = 'error'; connection.error = 'Reconnect failed. Try linking again.'; }); }, Math.min(1000 * 2 ** retries, 30000));
        } else if (!loggedOut) { connection.state = 'error'; connection.error = 'Could not reconnect. Click Link WhatsApp to retry.'; }
      }
    });
    return snapshot();
  }
  function cancel() {
    if (batch && ['queued', 'sending'].includes(batch.state)) { batch.state = 'cancelled'; store.saveBatch(batch); }
    return snapshot();
  }
  async function disconnect() {
    if (batch && ['queued', 'sending'].includes(batch.state)) throw new Error('Cancel the active batch before unlinking.');
    stopped = true; generation++; clearTimeout(retryTimer); retryTimer = null;
    const client = socket; socket = null;
    try { if (client) await client.logout(); } finally {
      client?.end(undefined); store.clearAuth();
      connection = { state: 'offline', qrDataUrl: '', account: null, error: '' };
    }
    return snapshot();
  }
  async function run(active) {
    for (const item of active.items) {
      if (active.state === 'cancelled') { item.status = 'cancelled'; store.saveBatch(active); continue; }
      item.status = 'sending'; active.state = 'sending'; store.saveBatch(active);
      try {
        if (connection.state !== 'ready' || !socket) throw new Error('WhatsApp is disconnected.');
        const result = await socket.sendMessage(`${item.phone}@s.whatsapp.net`, { text: item.message });
        item.status = 'sent'; item.providerMessageId = result?.key?.id || '';
      } catch (error) { item.status = 'failed'; item.error = error.message; }
      store.log({ ...item, createdAt: new Date().toISOString() }); store.saveBatch(active);
      if (item !== active.items.at(-1)) await delay(messageDelay);
    }
    if (active.state !== 'cancelled') active.state = 'completed';
    store.saveBatch(active);
  }
  function send(items) {
    if (connection.state !== 'ready') throw new Error('Link WhatsApp before sending.');
    if (batch && (['queued', 'sending'].includes(batch.state) || batch.items.some(i => ['queued', 'sending'].includes(i.status)))) throw new Error('A batch is already running.');
    if (!Array.isArray(items) || !items.length || items.length > 10) throw new Error('Send between 1 and 10 messages per batch.');
    const normalized = items.map(item => {
      let phone = String(item.phone || '').replace(/\D/g, '').replace(/^00/, '');
      if (phone.startsWith('0')) phone = `92${phone.slice(1)}`;
      if (!/^\d{10,15}$/.test(phone) || typeof item.message !== 'string' || !item.message.trim() || item.message.length > 10000) throw new Error('Each message needs a valid phone and text (up to 10,000 characters).');
      return { checkoutId: item.checkoutId, customerName: String(item.customerName || 'Customer'), phone, message: item.message, status: 'queued', error: '' };
    });
    batch = { id: randomUUID(), state: 'queued', total: normalized.length, items: normalized };
    store.saveBatch(batch);
    setImmediate(() => { void run(batch).catch(() => { batch.state = 'cancelled'; connection.error = 'Batch interrupted by a storage error; check history before retrying.'; }); });
    return snapshot();
  }
  return { snapshot, connect, disconnect, send, cancel, shutdown() { stopped = true; generation++; clearTimeout(retryTimer); socket?.end(undefined); } };
}
