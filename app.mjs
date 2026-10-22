import express from 'express';

export function createApp({ whatsapp, store, supabaseUrl, supabaseKey, origins, userIds, fetchUser = fetch }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: 'Portal origin is not allowed.' });
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
    res.set('Access-Control-Allow-Headers', 'authorization, content-type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in to the portal first.' });
    try {
      const response = await fetchUser(`${supabaseUrl}/auth/v1/user`, { headers: { Authorization: authorization, apikey: supabaseKey }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return res.status(401).json({ error: 'Session expired. Sign in again.' });
      const user = await response.json();
      if (!userIds.includes(user.id)) return res.status(403).json({ error: 'Your account is not allowed to manage WhatsApp. Add its UUID to ALLOWED_USER_IDS on Render.' });
      next();
    } catch { res.status(503).json({ error: 'Could not verify portal login. Try again.' }); }
  });
  app.use(express.json({ limit: '150kb' }));
  app.get('/api/status', (_req, res) => res.json(whatsapp.snapshot()));
  app.get('/api/history', (_req, res) => res.json({ history: store.history() }));
  app.post('/api/connect', async (_req, res) => res.json(await whatsapp.connect()));
  app.post('/api/disconnect', async (_req, res) => res.json(await whatsapp.disconnect()));
  app.post('/api/batches', (req, res) => res.status(202).json(whatsapp.send(req.body?.items)));
  app.post('/api/batches/cancel', (_req, res) => res.json(whatsapp.cancel()));
  app.use((error, _req, res, _next) => res.status(error.status || 400).json({ error: error.type === 'entity.too.large' ? 'Request is too large.' : error.message || 'Request failed.' }));
  return app;
}
