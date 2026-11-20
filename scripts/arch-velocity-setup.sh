#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this helper as root on the dedicated Velocity VM." >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]] || ! grep -Eq '^ID="?arch"?$' /etc/os-release; then
  echo "This helper supports installed Arch Linux guests only." >&2
  exit 1
fi

VELOCITY_VERSION="4.3.1"
VELOCITY_BUILD="45"
VELOCITY_SHA256="0844bcabdcdb4f5b875906fd4c3365bc1bb76918e42bc595ed88ad195258dd75"
VELOCITY_URL="https://fill-data.papermc.io/v1/objects/${VELOCITY_SHA256}/velocity-${VELOCITY_VERSION}-${VELOCITY_BUILD}.jar"
JAVA="/usr/lib/jvm/java-25-openjdk/bin/java"
JAR="/opt/velocity/velocity.jar"

pacman -S --needed --noconfirm jdk25-openjdk curl openssl
"${JAVA}" --version

getent group velocity >/dev/null || groupadd --system velocity
if ! id velocity >/dev/null 2>&1; then
  useradd --system --gid velocity --home-dir /srv/velocity \
    --no-create-home --shell /usr/bin/nologin velocity
fi
install -d -o root -g root -m 0755 /opt/velocity
install -d -o velocity -g velocity -m 0750 /srv/velocity
install -d -o root -g velocity -m 0750 /etc/velocity

if [[ ! -e "${JAR}" ]]; then
  DOWNLOAD="$(mktemp)"
  trap 'rm -f -- "${DOWNLOAD}"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 \
    --user-agent 'Blockhost/0.1 (https://github.com/Krumpy1337/Minecraft-Server-Dashboard)' \
    --output "${DOWNLOAD}" "${VELOCITY_URL}"
  printf '%s  %s\n' "${VELOCITY_SHA256}" "${DOWNLOAD}" | sha256sum --check --status
  install -o root -g root -m 0644 "${DOWNLOAD}" "${JAR}"
fi
printf '%s  %s\n' "${VELOCITY_SHA256}" "${JAR}" | sha256sum --check

if [[ ! -e /etc/velocity/forwarding.secret ]]; then
  (umask 077; openssl rand -hex 32 > /etc/velocity/forwarding.secret)
fi
if [[ ! -s /etc/velocity/forwarding.secret ]]; then
  echo "The existing forwarding secret is empty; refusing to replace it." >&2
  exit 1
fi
chown root:velocity /etc/velocity/forwarding.secret
chmod 0640 /etc/velocity/forwarding.secret

if [[ ! -e /srv/velocity/velocity.toml ]]; then
  cat > /srv/velocity/velocity.toml <<'EOF'
config-version = "2.9"
bind = "0.0.0.0:37001"
motd = "<aqua>Blockhost Gateway</aqua> <gray>- awaiting backend servers</gray>"
show-max-players = 100
online-mode = true
force-key-authentication = true
player-info-forwarding-mode = "modern"
forwarding-secret-file = "/etc/velocity/forwarding.secret"
enable-player-address-logging = false

[servers]
try = []

[forced-hosts]

[query]
enabled = false
EOF
  chown velocity:velocity /srv/velocity/velocity.toml
  chmod 0640 /srv/velocity/velocity.toml
fi

cat > /etc/systemd/system/velocity.service <<'EOF'
[Unit]
Description=Blockhost Velocity Minecraft gateway
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=velocity
Group=velocity
WorkingDirectory=/srv/velocity
ExecStart=/usr/lib/jvm/java-25-openjdk/bin/java -Xms256M -Xmx1G -XX:+UseG1GC -jar /opt/velocity/velocity.jar
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
SuccessExitStatus=143
UMask=0027
LimitNOFILE=65535
MemoryMax=1400M
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
ReadWritePaths=/srv/velocity

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/sudoers.d/velocity-control <<'EOF'
mcdeploy ALL=(root) NOPASSWD: /usr/bin/systemctl start velocity.service, /usr/bin/systemctl stop velocity.service, /usr/bin/systemctl restart velocity.service, /usr/bin/systemctl status velocity.service
EOF
chmod 0440 /etc/sudoers.d/velocity-control
visudo --check --file=/etc/sudoers.d/velocity-control
systemd-analyze verify /etc/systemd/system/velocity.service
systemctl disable --now minecraft.service
systemctl daemon-reload
systemctl enable --now velocity.service
systemctl is-active --quiet velocity.service
echo "Velocity ${VELOCITY_VERSION} build ${VELOCITY_BUILD} enabled on TCP port 37001."
echo "No backend servers, DNS records, router rules, or Minecraft EULA files were created."
