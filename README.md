# WhatsApp linked-device backend for Render

This is a separate Node service. It pairs using WhatsApp â†’ Linked devices â†’ Link a device, without Meta API tokens or templates. The portal still uses Supabase for login and checkout storage. WhatsApp credentials, encryption keys and send history live in SQLite on the Render disk. No Supabase message-log migration is needed for this backend.

## Deploy

Publish this repository, then create a Render **Web Service**:

- Root Directory: leave blank
- Runtime: Node; environment variable `NODE_VERSION=22.22.2`
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/health`
- Instance: paid Starter or higher; one instance only
- Persistent disk: mount at `/var/data`, size 1 GB

Set environment variables:

```text
DATA_DIR=/var/data
SUPABASE_URL=https://pjqiaprsgwdkpgmdayif.supabase.co
SUPABASE_ANON_KEY=<copy VITE_SUPABASE_KEY from your portal environment>
ALLOWED_ORIGINS=https://your-portal-domain.com
ALLOWED_USER_IDS=<your Supabase Auth user UUID>
```

Find your UUID in Supabase Dashboard â†’ Authentication â†’ Users. Multiple allowed user IDs or exact portal origins can be separated with commas. Origins contain scheme and hostname, no path or trailing slash. All allowed users manage the same linked WhatsApp account. Do not use a service-role key. Keep Supabase email signup restricted to your intended portal users.

For a Blueprint deploy, select `render.yaml` as the Blueprint path. This repository contains the backend at its root; leave Root Directory blank.

## Connect the portal

Add this variable to the **frontend hosting** environment, then rebuild/redeploy the frontend:

```text
VITE_WHATSAPP_BACKEND_URL=https://your-service.onrender.com
```

For local frontend use, add the same variable to the root `.env` and restart Vite. Do not put backend secrets in VITE variables. Open Abandoned Checkouts â†’ Link WhatsApp. Scan the displayed QR with WhatsApp â†’ Linked devices â†’ Link a device. It refreshes automatically. After linking, confirm the account/phone displayed and send one message to a test checkout you control before using customer batches.

## Operation

- The backend restores a saved session when Render restarts. Keep the disk attached; an ephemeral/free instance loses credentials on deploy and sleeps when idle.
- Sends use the exact text previewed in the portal. Batches are limited to ten and spaced by three seconds. `MESSAGE_DELAY_MS` can increase spacing.
- Cancel stops remaining messages; an already in-flight message may still send. Interrupted batches are not replayed after restart; check WhatsApp before retrying an uncertain send.
- `sent` means WhatsApp accepted the send, not recipient delivery/read confirmation. History is stored locally on the disk; this service does not update the Supabase checkout recovery status.
- Unlink device logs out and deletes local linking credentials. It preserves message history. Cancel a running batch first.
- Keep one replica. Back up the disk securely: it contains device credentials and customer message history. Baileys is an unofficial WhatsApp Web integration; WhatsApp can revoke a linked session or change its protocol.

## Local backend development (optional)

```powershell
cd portal-backend
Copy-Item .env.example .env
# Fill .env, including your allowed user UUID and frontend origin.
npm ci
npm start
```

No Windows startup tasks or laptop supervisor are installed. Production runs on Render.
