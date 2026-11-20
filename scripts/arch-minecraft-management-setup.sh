#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 || ! -f /usr/local/libexec/blockhost-minecraft-console ]]; then
  echo "Run as root after configuring the restricted Minecraft console." >&2
  exit 1
fi
if [[ ! "${SFTP_GATEWAY_IP:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] ||
   [[ ! "${MINECRAFT_FILES_PUBLIC_KEY:-}" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] ||
   [[ "${MINECRAFT_FILES_PUBLIC_KEY}" == *$'\n'* || "${MINECRAFT_FILES_PUBLIC_KEY}" == *$'\r'* ]]; then
  echo "Supply SFTP_GATEWAY_IP and one Ed25519 MINECRAFT_FILES_PUBLIC_KEY." >&2
  exit 1
fi
if [[ ! -f "${MANAGEMENT_HELPER_FILE:-}" ]]; then
  echo "MANAGEMENT_HELPER_FILE must contain minecraft-management.cjs." >&2
  exit 1
fi
pacman -S --needed --noconfirm nodejs
install -o root -g root -m 0755 "${MANAGEMENT_HELPER_FILE}" /usr/local/libexec/blockhost-minecraft-management.cjs
chown minecraft:minecraft /srv/minecraft
chmod 2770 /srv/minecraft
install -d -o root -g root -m 0755 /srv/blockhost /srv/blockhost/sftp
if ! mountpoint -q /srv/blockhost/sftp/files; then
  install -d -o root -g root -m 0755 /srv/blockhost/sftp/files
fi
if ! grep -Fq '/srv/minecraft /srv/blockhost/sftp/files ' /etc/fstab; then
  printf '/srv/minecraft /srv/blockhost/sftp/files none bind,nosuid,nodev,noexec 0 0\n' >> /etc/fstab
fi
mountpoint -q /srv/blockhost/sftp/files || mount /srv/blockhost/sftp/files
printf 'from="%s",restrict %s\n' "${SFTP_GATEWAY_IP}" "${MINECRAFT_FILES_PUBLIC_KEY}" > /etc/ssh/authorized_keys/minecraft
chown root:root /etc/ssh/authorized_keys/minecraft
chmod 0644 /etc/ssh/authorized_keys/minecraft
printf 'HostKey /etc/ssh/ssh_host_ed25519_key\n' > /etc/ssh/sshd_config.d/15-blockhost-host-key.conf
cat > /etc/ssh/sshd_config.d/25-blockhost-files.conf <<'EOF'
AllowUsers minecraft
Match User minecraft
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    AuthenticationMethods publickey
    ChrootDirectory /srv/blockhost/sftp
    ForceCommand internal-sftp -d /files -u 0007
    DisableForwarding yes
    PermitTTY no
Match all
EOF
if ! grep -Fq 'blockhost-minecraft-management.cjs' /usr/local/libexec/blockhost-minecraft-console; then
  sed -i '/^case .*SSH_ORIGINAL_COMMAND.* in$/a\  metrics|settings-get|settings-set)\n    exec /usr/bin/node /usr/local/libexec/blockhost-minecraft-management.cjs "${SSH_ORIGINAL_COMMAND}"\n    ;;' /usr/local/libexec/blockhost-minecraft-console
fi
bash -n /usr/local/libexec/blockhost-minecraft-console
/usr/bin/sshd -t
systemctl daemon-reload
systemctl reload sshd.service
echo "Private, jailed SFTP and restricted metrics/settings operations configured."
