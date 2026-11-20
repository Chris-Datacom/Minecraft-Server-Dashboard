#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this helper as root on the dedicated SFTP gateway." >&2
  exit 1
fi
for value in "${GATEWAY_IP:-}" "${WEBSITE_IP:-}"; do
  if [[ ! "${value}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "GATEWAY_IP and WEBSITE_IP must be LAN IPv4 addresses." >&2
    exit 1
  fi
done
if [[ ! "${SFTPGO_DEFAULT_ADMIN_PASSWORD:-}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Supply a generated 32-byte hexadecimal bootstrap admin password." >&2
  exit 1
fi
if [[ -e /etc/sftpgo/sftpgo.json ]]; then
  echo "Gateway configuration already exists; refusing to overwrite it." >&2
  exit 1
fi

pacman -S --needed --noconfirm curl openssl nftables
if ! modprobe nf_tables; then
  echo "The running kernel cannot load nftables. Finish Cloud-Init updates, reboot, then rerun this helper." >&2
  exit 1
fi
getent group sftpgo >/dev/null || groupadd --system sftpgo
id sftpgo >/dev/null 2>&1 || useradd --system --gid sftpgo \
  --home-dir /var/lib/sftpgo --no-create-home --shell /usr/bin/nologin sftpgo
install -d -o root -g sftpgo -m 0750 /etc/sftpgo
install -d -o sftpgo -g sftpgo -m 0700 /var/lib/sftpgo
work="$(mktemp -d)"
trap 'rm -f "${work}/sftpgo.tar.xz"; rm -rf "${work}/release"; rmdir "${work}"' EXIT
curl --fail --silent --show-error --location \
  https://github.com/drakkan/sftpgo/releases/download/v2.7.6/sftpgo_v2.7.6_linux_x86_64.tar.xz \
  --output "${work}/sftpgo.tar.xz"
printf '71f5c9ae3284fc20bb606b2cf396db49645f9bdf4dba770cd76d6fd4720d5cb4  %s\n' \
  "${work}/sftpgo.tar.xz" | sha256sum --check
mkdir "${work}/release"
tar -xJf "${work}/sftpgo.tar.xz" --directory "${work}/release" --no-same-owner
install -o root -g root -m 0755 "${work}/release/sftpgo" /usr/local/bin/sftpgo
cp -a "${work}/release/templates" "${work}/release/static" "${work}/release/openapi" /etc/sftpgo/
ssh-keygen -q -t ed25519 -N '' -C blockhost-sftp-gateway -f /etc/sftpgo/host_ed25519
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 825 \
  -subj /CN=Blockhost-SFTP-Management \
  -addext "subjectAltName=IP:${GATEWAY_IP},IP:127.0.0.1,DNS:sftp.krumpy.xyz" \
  -keyout /etc/sftpgo/management.key -out /etc/sftpgo/management.crt 2>/dev/null
chown root:sftpgo /etc/sftpgo/host_ed25519 /etc/sftpgo/management.key /etc/sftpgo/management.crt
chmod 0640 /etc/sftpgo/host_ed25519 /etc/sftpgo/management.key /etc/sftpgo/management.crt
cat > /etc/sftpgo/sftpgo.json <<'EOF'
{
  "common": {
    "idle_timeout": 10, "max_total_connections": 200, "max_per_host_connections": 40,
    "defender": {"enabled": true}
  },
  "sftpd": {
    "bindings": [{"port": 2022, "address": "0.0.0.0"}],
    "host_keys": ["/etc/sftpgo/host_ed25519"],
    "enabled_ssh_commands": [], "password_authentication": false,
    "keyboard_interactive_authentication": false, "max_auth_tries": 4
  },
  "ftpd": {"bindings": [{"port": 0}]},
  "webdavd": {"bindings": [{"port": 0}]},
  "data_provider": {
    "driver": "sqlite", "name": "/var/lib/sftpgo/sftpgo.db",
    "users_base_dir": "/var/lib/sftpgo/users", "backups_path": "/var/lib/sftpgo/provider-backups"
  },
  "httpd": {
    "bindings": [{
      "port": 8443, "address": "0.0.0.0", "enable_https": true,
      "enable_web_admin": false, "enable_web_client": false, "enable_rest_api": true,
      "render_openapi": false,
      "certificate_file": "/etc/sftpgo/management.crt",
      "certificate_key_file": "/etc/sftpgo/management.key"
    }]
  }
}
EOF
umask 077
printf 'SFTPGO_DATA_PROVIDER__CREATE_DEFAULT_ADMIN=true\nSFTPGO_DEFAULT_ADMIN_USERNAME=bootstrap\nSFTPGO_DEFAULT_ADMIN_PASSWORD=%s\n' \
  "${SFTPGO_DEFAULT_ADMIN_PASSWORD}" > /etc/sftpgo/bootstrap.env
unset SFTPGO_DEFAULT_ADMIN_PASSWORD
cat > /etc/systemd/system/sftpgo.service <<'EOF'
[Unit]
Description=Blockhost shared SFTP gateway
After=network-online.target blockhost-sftp-firewall.service
Wants=network-online.target
Requires=blockhost-sftp-firewall.service

[Service]
User=sftpgo
Group=sftpgo
WorkingDirectory=/var/lib/sftpgo
EnvironmentFile=-/etc/sftpgo/bootstrap.env
ExecStart=/usr/local/bin/sftpgo serve --config-dir /etc/sftpgo --log-file-path "" --log-level info
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadWritePaths=/var/lib/sftpgo

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/sftpgo/firewall.nft <<EOF
table inet blockhost_sftp {
  chain input {
    type filter hook input priority -5; policy accept;
    tcp dport 8443 ip saddr != ${WEBSITE_IP} ip saddr != 127.0.0.1 drop
    meta nfproto ipv6 tcp dport 8443 drop
  }
}
EOF
cat > /etc/systemd/system/blockhost-sftp-firewall.service <<'EOF'
[Unit]
Description=Restrict the SFTP management API to the website
Before=sftpgo.service

[Service]
Type=oneshot
RemainAfterExit=true
ExecStartPre=-/usr/bin/nft delete table inet blockhost_sftp
ExecStart=/usr/bin/nft -f /etc/sftpgo/firewall.nft

[Install]
WantedBy=multi-user.target
EOF
systemctl disable --now minecraft.service
systemctl daemon-reload
systemctl enable --now blockhost-sftp-firewall.service sftpgo.service
/usr/local/bin/sftpgo --version
echo "Gateway installed: key-only SFTP on TCP 2022; private HTTPS management on TCP 8443."
