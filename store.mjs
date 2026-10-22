import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

export function createStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'whatsapp.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS auth (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const read = (id) => {
    const row = db.prepare('SELECT value FROM auth WHERE id=?').get(id);
    return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
  };
  const write = (id, value) => {
    if (value == null) db.prepare('DELETE FROM auth WHERE id=?').run(id);
    else db.prepare('INSERT OR REPLACE INTO auth VALUES (?,?)').run(id, JSON.stringify(value, BufferJSON.replacer));
  };
  return {
    hasSession: () => Boolean(read('creds')?.registered),
    auth() {
      const creds = read('creds') || initAuthCreds();
      return {
        state: { creds, keys: {
          async get(type, ids) {
            const result = {};
            for (const id of ids) {
              let value = read(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
              if (value) result[id] = value;
            }
            return result;
          },
          async set(data) {
            db.exec('BEGIN');
            try {
              for (const [type, entries] of Object.entries(data)) {
                for (const [id, value] of Object.entries(entries)) write(`${type}-${id}`, value);
              }
              db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
          },
        } },
        saveCreds: async () => write('creds', creds),
      };
    },
    clearAuth: () => db.exec('DELETE FROM auth'),
    saveBatch: (batch) => db.prepare('INSERT OR REPLACE INTO batches VALUES (?,?)').run(batch.id, JSON.stringify(batch)),
    latestBatch: () => {
      const row = db.prepare('SELECT value FROM batches ORDER BY rowid DESC LIMIT 1').get();
      return row ? JSON.parse(row.value) : null;
    },
    log: (entry) => db.prepare('INSERT INTO messages(value) VALUES (?)').run(JSON.stringify(entry)),
    history: () => db.prepare('SELECT value FROM messages ORDER BY id DESC LIMIT 200').all().map(row => JSON.parse(row.value)),
    close: () => db.close(),
  };
}
