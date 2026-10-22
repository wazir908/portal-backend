import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.mjs';
import { createStore } from './store.mjs';

test('API protects QR and sends with validated Supabase user and origin', async t => {
  let calls = 0;
  const app = createApp({ whatsapp: { snapshot: () => ({ connection: { state: 'qr', qrDataUrl: 'private' } }) }, store: {}, supabaseUrl: 'https://example.supabase.co', supabaseKey: 'public', origins: ['https://portal.test'], userIds: ['staff'], fetchUser: async (_url, options) => {
    calls++;
    return { ok: options.headers.Authorization !== 'Bearer invalid', json: async () => ({ id: options.headers.Authorization === 'Bearer staff' ? 'staff' : 'outsider' }) };
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/api/status')).status, 401);
  assert.equal((await fetch(base + '/api/status', { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  assert.equal((await fetch(base + '/api/status', { headers: { Authorization: 'Bearer outsider' } })).status, 403);
  assert.equal((await fetch(base + '/api/status', { headers: { Origin: 'https://evil.test', Authorization: 'Bearer staff' } })).status, 403);
  const response = await fetch(base + '/api/status', { headers: { Origin: 'https://portal.test', Authorization: 'Bearer staff' } });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://portal.test');
  assert.equal((await response.json()).connection.qrDataUrl, 'private');
  assert.equal(calls, 3);
});

test('SQLite preserves credentials, binary encryption keys and history across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bodf-wa-'));
  let store = createStore(directory);
  try {
    let auth = store.auth();
    auth.state.creds.registered = true;
    await auth.saveCreds();
    await auth.state.keys.set({ session: { abc: Buffer.from('secret') } });
    store.log({ checkoutId: 123, status: 'sent' });
    store.saveBatch({ id: 'batch1', state: 'completed', items: [] });
    store.close(); store = createStore(directory);
    auth = store.auth();
    assert.equal(store.hasSession(), true);
    assert.deepEqual((await auth.state.keys.get('session', ['abc'])).abc, Buffer.from('secret'));
    assert.equal(store.history()[0].checkoutId, 123);
    assert.equal(store.latestBatch().id, 'batch1');
    store.clearAuth(); assert.equal(store.hasSession(), false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
