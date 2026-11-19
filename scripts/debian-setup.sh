#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this one-time setup with sudo, for example: sudo bash scripts/debian-setup.sh" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify this operating system." >&2
  exit 1
fi

source /etc/os-release
if [[ "${ID:-}" != "debian" ]]; then
  echo "This helper supports Debian only." >&2
  exit 1
fi

APP_USER="blockhost"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="/opt/blockhost"
SERVICE_FILE="/etc/systemd/system/blockhost.service"
ENV_FILE="${APP_DIR}/.env"

if ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "The ${APP_USER} account must exist before running setup." >&2
  exit 1
fi
if [[ ! -f "${SOURCE_DIR}/package.json" ]]; then
  echo "Project files are missing from ${SOURCE_DIR}." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm postgresql

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node.js 20 or newer is required; found $(node --version)." >&2
  exit 1
fi

systemctl enable --now postgresql
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${APP_DIR}"

tar \
  --exclude='./.env*' \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./dist' \
  -C "${SOURCE_DIR}" -cf - . | tar -C "${APP_DIR}" -xf -

if [[ ! -f "${ENV_FILE}" ]]; then
  ROLE_EXISTS="$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'blockhost_app'")"
  DB_EXISTS="$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'blockhost'")"
  if [[ "${ROLE_EXISTS}" == "1" || "${DB_EXISTS}" == "1" ]]; then
    echo "A Blockhost database role or database already exists without an app .env; refusing to replace credentials." >&2
    exit 1
  fi

  DB_PASSWORD="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -hex 48)"
  CREDENTIALS_KEY="$(openssl rand -hex 32)"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE blockhost_app LOGIN PASSWORD '${DB_PASSWORD}'"
  runuser -u postgres -- createdb --owner=blockhost_app blockhost

  umask 077
  cat > "${ENV_FILE}" <<EOF
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
APP_SESSION_SECRET=${SESSION_SECRET}
DATABASE_URL=postgresql://blockhost_app:${DB_PASSWORD}@127.0.0.1:5432/blockhost
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_CALLBACK_URL=https://blockhost.krumpy.xyz/auth/discord/callback
DISCORD_ADMIN_USER_IDS=
PROXMOX_API_URL=
PROXMOX_TOKEN_ID=
PROXMOX_TOKEN_SECRET=
PROXMOX_VM_ID=115
PROXMOX_VM_NAME=blockhost
SERVER_CREDENTIALS_KEY=${CREDENTIALS_KEY}
MINECRAFT_ALLOWED_HOSTS=
EOF
  unset DB_PASSWORD SESSION_SECRET CREDENTIALS_KEY
fi

chmod 600 "${ENV_FILE}"
chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

runuser -u "${APP_USER}" -- bash -c "cd '${APP_DIR}' && npm install --no-audit --no-fund && npm run build && npm prune --omit=dev"

cat > "${SERVICE_FILE}" <<'EOF'
[Unit]
Description=Blockhost Minecraft Server Dashboard
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=blockhost
Group=blockhost
WorkingDirectory=/opt/blockhost
EnvironmentFile=/opt/blockhost/.env
ExecStart=/usr/bin/node /opt/blockhost/dist/server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "Setup is prepared. Configure ${ENV_FILE}, then run: systemctl enable --now blockhost"
