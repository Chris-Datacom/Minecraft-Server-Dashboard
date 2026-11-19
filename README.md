# Blockhost

Blockhost is a Minecraft server dashboard prototype with a Node.js/TypeScript backend, Discord-only sign-in, per-account hosting plans, optional Minecraft plugin connections, and admin-only Proxmox VM statistics.

## Local setup

Requirements: Node.js 20+, npm, and PostgreSQL.

1. Copy `.env.example` to `.env`.
2. Create a Discord application and add the callback URL from `DISCORD_CALLBACK_URL` under OAuth2 Redirects. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in `.env`.
3. Set `DISCORD_ADMIN_USER_IDS` to a comma-separated list of Discord numeric user IDs. Admin access is determined from the verified Discord account ID, never the username.
4. Configure `DATABASE_URL` for PostgreSQL and `APP_SESSION_SECRET` to a random value of at least 32 characters (for example, generate one with `openssl rand -base64 48`).
5. Configure `PROXMOX_API_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`, `PROXMOX_VM_ID`, and `PROXMOX_VM_NAME`. Use a least-privilege Proxmox token with read-only cluster-resource and VM-audit access.
6. Configure `SERVER_CREDENTIALS_KEY` with 32 random bytes encoded as hex (`openssl rand -hex 32`). Add exact plugin API hostnames to `MINECRAFT_ALLOWED_HOSTS`; unlisted hosts are rejected.
7. Install and start the app:

   ```sh
   npm install
   npm run dev
   ```

Visit `http://localhost:3000`. The explicit demo option uses sample data only in that browser. Authenticated Discord accounts start with empty live-data states and do not receive sample server, activity, file, or backup information.

## Debian VM deployment

Run the app behind a Cloudflare Tunnel. Discord OAuth requires the public callback URL to exactly match `DISCORD_CALLBACK_URL`.

The one-time helper installs Node.js/npm and PostgreSQL, creates the app database and random secrets, builds the project, and writes a hardened systemd unit. It does not copy the local `.env`, enable the Blockhost service, or start it. Run it from the SSH session on the VM:

```sh
cd /home/blockhost/blockhost-dashboard
sudo bash scripts/debian-setup.sh
```

Enter your sudo password in your own terminal; do not put it in `.env` or send it in chat. After setup completes, edit `/opt/blockhost/.env` with `sudoedit` and fill in the Discord application ID/secret, your numeric Discord admin ID, Proxmox API URL/token, and exact plugin hostnames in `MINECRAFT_ALLOWED_HOSTS`. The helper leaves those integration values blank and protects the generated env file with mode `0600`. The callback is prefilled as `https://blockhost.krumpy.xyz/auth/discord/callback`.

Once configuration is complete, start the app and check its status:

```sh
sudo systemctl enable --now blockhost
sudo systemctl status blockhost --no-pager
```

Configure the Cloudflare Tunnel hostname `blockhost.krumpy.xyz` to forward to `http://127.0.0.1:3000`. Do not expose the app or PostgreSQL ports directly to the internet. Keep PostgreSQL backups.

### Proxmox connectivity

Allow the Debian VM to reach the Proxmox API over HTTPS. Keep certificate verification enabled: install your Proxmox CA certificate into Debian's trusted CA store if needed. Do not disable TLS verification or expose the Proxmox token to browser code. The `/api/admin/proxmox/status` endpoint looks up the configured VM by ID and name through the cluster resources API, so it can find the VM on any node in that cluster. It verifies the signed-in Discord account against `DISCORD_ADMIN_USER_IDS` on every request and returns `401` or `403` otherwise.

Minecraft API credentials are encrypted at rest using `SERVER_CREDENTIALS_KEY`; each linked server is scoped to the Discord account that added it. The plugin's `/api` command supplies a key, not a URL; the server owner must separately provide the plugin API URL. `MINECRAFT_ALLOWED_HOSTS` must contain exact plugin hostnames before users can connect them. The current connector requires valid HTTPS on the standard port, rejects redirects, and checks `GET /v1/server` before saving a connection. It then expects `GET /v1/players`, `/v1/groups`, and `/v1/tracks`, plus `POST /v1/groups/create`, `/v1/groups/delete`, `/v1/groups/prefix`, `/v1/players/group`, `/v1/players/promote`, and `/v1/players/demote`. A key-generation command without a reachable API implementing these routes is not sufficient to manage a server.

### Hosting plans

Site administrators can create and edit plans and assign them to Discord accounts under **Plans & accounts**. Plan 1 is seeded with 1 server, 4 vCPU, 4096 MiB RAM, and 32 GB disk per server; Plan 2 with 2 servers, 6 vCPU, 8192 MiB RAM, and 40 GB disk; Plan 3 with an unlimited server count and an editable per-server resource limit. Plan 3 starts at 6 vCPU, 8192 MiB RAM, and 40 GB disk. Users must be assigned a plan before hosting is available. The **Create server** actions are the primary server workflow, while the BadApple API is optional. VM provisioning is not enabled until the Proxmox template, storage, guest setup, and gateway routing are configured and verified.
