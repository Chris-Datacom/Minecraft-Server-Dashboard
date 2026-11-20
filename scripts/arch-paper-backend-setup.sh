#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this helper as root on a fresh backend clone." >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]] || ! grep -Eq '^ID="?arch"?$' /etc/os-release; then
  echo "This helper supports installed Arch Linux guests only." >&2
  exit 1
fi
if [[ "${MINECRAFT_EULA_ACCEPTED:-}" != "true" ]]; then
  echo "Explicit acceptance of https://www.minecraft.net/eula is required; set MINECRAFT_EULA_ACCEPTED=true only after consent." >&2
  exit 1
fi
RAM_MB="${MINECRAFT_RAM_MB:-4096}"
SERVER_HOSTNAME="${MINECRAFT_HOSTNAME:-test.krumpy.xyz}"
DEFER_START="${MINECRAFT_DEFER_START:-false}"
if [[ ! "${RAM_MB}" =~ ^[0-9]+$ ]] || (( RAM_MB < 2048 || RAM_MB > 8192 || RAM_MB % 256 )) ||
   [[ ! "${SERVER_HOSTNAME}" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$ ]] ||
   [[ "${DEFER_START}" != "true" && "${DEFER_START}" != "false" ]]; then
  echo "Invalid Minecraft RAM, hostname, or deferred-start configuration." >&2
  exit 1
fi
HEAP_MB="$(( RAM_MB - 1024 ))"
MEMORY_MAX_MB="$(( RAM_MB - 256 ))"
if [[ ! -r "${VELOCITY_FORWARDING_SECRET_FILE:-}" ]]; then
  echo "VELOCITY_FORWARDING_SECRET_FILE must name a readable secret file." >&2
  exit 1
fi
FORWARDING_SECRET="$(cat -- "${VELOCITY_FORWARDING_SECRET_FILE}")"
if [[ ! "${FORWARDING_SECRET}" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Expected a 32-byte hexadecimal Velocity forwarding secret." >&2
  exit 1
fi
if [[ ! "${VELOCITY_GATEWAY_IP:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "VELOCITY_GATEWAY_IP must be the gateway's LAN IPv4 address." >&2
  exit 1
fi
IFS=. read -r -a OCTETS <<< "${VELOCITY_GATEWAY_IP}"
for OCTET in "${OCTETS[@]}"; do
  if (( 10#${OCTET} > 255 )); then
    echo "VELOCITY_GATEWAY_IP contains an invalid IPv4 octet." >&2
    exit 1
  fi
done
if [[ -e /srv/minecraft/server.properties || -e /srv/minecraft/config/paper-global.yml ]]; then
  echo "Existing backend configuration found; refusing to overwrite it." >&2
  exit 1
fi
if ! id minecraft >/dev/null 2>&1 || [[ ! -f /etc/systemd/system/minecraft.service ]]; then
  echo "Run the Arch Minecraft template helper before configuring a backend." >&2
  exit 1
fi

PAPER_SHA256="c86baf83b1fb0eb0d572f39484c242210896c6adf9cc9342d5c16c4de70c9bdc"
PAPER_URL="https://fill-data.papermc.io/v1/objects/${PAPER_SHA256}/paper-26.3-256.jar"
pacman -S --needed --noconfirm jdk25-openjdk curl nftables
/usr/lib/jvm/java-25-openjdk/bin/java --version
systemctl stop minecraft.service

if [[ ! -e /srv/minecraft/server.jar ]]; then
  DOWNLOAD="$(mktemp)"
  trap 'rm -f -- "${DOWNLOAD}"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 \
    --user-agent 'Blockhost/0.1 (https://github.com/Krumpy1337/Minecraft-Server-Dashboard)' \
    --output "${DOWNLOAD}" "${PAPER_URL}"
  printf '%s  %s\n' "${PAPER_SHA256}" "${DOWNLOAD}" | sha256sum --check --status
  install -o root -g minecraft -m 0640 "${DOWNLOAD}" /srv/minecraft/server.jar
fi
printf '%s  %s\n' "${PAPER_SHA256}" /srv/minecraft/server.jar | sha256sum --check

install -d -o minecraft -g minecraft -m 0750 /srv/minecraft/config
umask 027
cat > /srv/minecraft/server.properties <<EOF
server-port=25565
online-mode=false
enforce-secure-profile=true
white-list=false
enforce-whitelist=false
motd=Blockhost - ${SERVER_HOSTNAME}
max-players=20
view-distance=8
simulation-distance=6
enable-rcon=false
enable-query=false
EOF
cat > /srv/minecraft/config/paper-global.yml <<EOF
proxies:
  velocity:
    enabled: true
    online-mode: true
    secret: "${FORWARDING_SECRET}"
EOF
unset FORWARDING_SECRET
cat > /srv/minecraft/spigot.yml <<'EOF'
settings:
  bungeecord: false
EOF
chown minecraft:minecraft /srv/minecraft/server.properties \
  /srv/minecraft/config/paper-global.yml /srv/minecraft/spigot.yml
chmod 0640 /srv/minecraft/server.properties \
  /srv/minecraft/config/paper-global.yml /srv/minecraft/spigot.yml

cat > /etc/minecraft/firewall.nft <<EOF
add table inet blockhost_minecraft
flush table inet blockhost_minecraft
table inet blockhost_minecraft {
  chain input {
    type filter hook input priority 0; policy accept;
    ip saddr ${VELOCITY_GATEWAY_IP} tcp dport 25565 counter accept
    tcp dport 25565 counter drop
  }
}
EOF
nft --check --file /etc/minecraft/firewall.nft
cat > /etc/systemd/system/minecraft-firewall.service <<'EOF'
[Unit]
Description=Restrict Minecraft backend access to Velocity
Before=minecraft.service

[Service]
Type=oneshot
ExecStart=/usr/bin/nft --file /etc/minecraft/firewall.nft
ExecReload=/usr/bin/nft --file /etc/minecraft/firewall.nft
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
install -d -o root -g root -m 0755 /etc/systemd/system/minecraft.service.d
cat > /etc/systemd/system/minecraft.service.d/paper.conf <<EOF
[Unit]
Requires=minecraft-firewall.service
After=minecraft-firewall.service

[Service]
ExecStart=
ExecStart=/usr/lib/jvm/java-25-openjdk/bin/java \$JAVA_OPTS -jar \$SERVER_JAR nogui
TimeoutStopSec=120
MemoryMax=${MEMORY_MAX_MB}M
UMask=0027
EOF
cat > /etc/minecraft/server.env <<EOF
SERVER_JAR=server.jar
JAVA_OPTS="-Xms512M -Xmx${HEAP_MB}M"
EOF
printf 'eula=true\n' > /srv/minecraft/eula.txt
chown minecraft:minecraft /srv/minecraft/eula.txt
chmod 0640 /srv/minecraft/eula.txt
printf 'accepted_at=%s\nsource=explicit-operator-consent\nurl=https://www.minecraft.net/eula\n' \
  "$(date -u +%FT%TZ)" > /etc/minecraft/eula-acceptance.txt
chmod 0600 /etc/minecraft/eula-acceptance.txt

systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/minecraft.service \
  /etc/systemd/system/minecraft-firewall.service
systemctl enable --now minecraft-firewall.service
systemctl enable minecraft.service
if [[ "${DEFER_START}" == "false" ]]; then
  systemctl start minecraft.service
  echo "Paper 26.3 build 256 started; verify its Done message before connecting players."
else
  echo "Paper configured; start deferred until console and storage setup are complete."
fi
echo "TCP 25565 is restricted to the Velocity gateway."
