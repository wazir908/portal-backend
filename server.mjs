import { createStore } from './store.mjs';
import { createWhatsApp } from './whatsapp.mjs';
import { createApp } from './app.mjs';

const list = value => (value || '').split(',').map(v => v.trim()).filter(Boolean);
const { SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_ORIGINS, ALLOWED_USER_IDS } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ALLOWED_ORIGINS || !ALLOWED_USER_IDS) throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_ORIGINS and ALLOWED_USER_IDS. See .env.example.');
const store = createStore(process.env.DATA_DIR || './data');
const whatsapp = createWhatsApp(store, Math.max(1000, Number(process.env.MESSAGE_DELAY_MS) || 3000));
const app = createApp({ whatsapp, store, supabaseUrl: SUPABASE_URL.replace(/\/$/, ''), supabaseKey: SUPABASE_ANON_KEY, origins: list(ALLOWED_ORIGINS), userIds: list(ALLOWED_USER_IDS) });
const server = app.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => console.log('WhatsApp backend listening.'));
if (store.hasSession()) void whatsapp.connect().catch(() => console.error('Session restore failed. Link again from the portal.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  whatsapp.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
