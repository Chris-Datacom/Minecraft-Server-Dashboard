#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 || ! -f /etc/sftpgo/sftpgo.json ]]; then
  echo "Run as root on the configured SFTP gateway." >&2
  exit 1
fi
if [[ ! "${WEBSITE_IP:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] ||
   [[ ! "${SFTP_ACCESS_PUBLIC_KEY:-}" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] ||
   [[ "${SFTP_ACCESS_PUBLIC_KEY}" == *$'\n'* || "${SFTP_ACCESS_PUBLIC_KEY}" == *$'\r'* ]] ||
   [[ ! -f "${ACCESS_HELPER_FILE:-}" ]]; then
  echo "Supply WEBSITE_IP, one SFTP_ACCESS_PUBLIC_KEY, and ACCESS_HELPER_FILE." >&2
  exit 1
fi
pacman -S --needed --noconfirm nodejs
install -d -o root -g root -m 0755 /usr/local/libexec /etc/ssh/authorized_keys
install -o root -g root -m 0755 "${ACCESS_HELPER_FILE}" /usr/local/libexec/blockhost-sftp-access.cjs
id sftpaccess >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /bin/bash sftpaccess
passwd --lock sftpaccess >/dev/null
printf 'from="%s",restrict %s\n' "${WEBSITE_IP}" "${SFTP_ACCESS_PUBLIC_KEY}" > /etc/ssh/authorized_keys/sftpaccess
chown root:root /etc/ssh/authorized_keys/sftpaccess
chmod 0644 /etc/ssh/authorized_keys/sftpaccess
cat > /etc/ssh/sshd_config.d/25-blockhost-sftp-access.conf <<'EOF'
AllowUsers sftpaccess
Match User sftpaccess
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    AuthenticationMethods publickey
    ForceCommand sudo -A /usr/bin/node /usr/local/libexec/blockhost-sftp-access.cjs
    DisableForwarding yes
    PermitTTY no
Match all
EOF
cat > /etc/sudoers.d/blockhost-sftp-access <<'EOF'
sftpaccess ALL=(root) NOPASSWD: /usr/bin/node /usr/local/libexec/blockhost-sftp-access.cjs
EOF
chmod 0440 /etc/sudoers.d/blockhost-sftp-access
visudo --check --file=/etc/sudoers.d/blockhost-sftp-access
/usr/bin/sshd -t
cat > /etc/sftpgo/firewall.nft <<EOF
table inet blockhost_sftp {
  set clients4 { type ipv4_addr; flags timeout; timeout 1h; }
  set clients6 { type ipv6_addr; flags timeout; timeout 1h; }
  chain input {
    type filter hook input priority -5; policy accept;
    tcp dport 8443 ip saddr != { ${WEBSITE_IP}, 127.0.0.1 } drop
    meta nfproto ipv6 tcp dport 8443 drop
    tcp dport 2022 ip saddr ${WEBSITE_IP} accept
    tcp dport 2022 ip saddr @clients4 accept
    tcp dport 2022 ip6 saddr @clients6 accept
    tcp dport 2022 drop
  }
}
EOF
systemctl restart blockhost-sftp-firewall.service
systemctl reload sshd.service
echo "SFTP is now fail-closed except for the website and temporary, kernel-expiring IP grants."
