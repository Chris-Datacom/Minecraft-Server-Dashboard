#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]] || [[ ! -f /etc/systemd/system/minecraft.service ]]; then
  echo "Run this helper as root on a configured Minecraft backend." >&2
  exit 1
fi
if [[ "${MINECRAFT_DEFER_START:-false}" != "true" && "${MINECRAFT_DEFER_START:-false}" != "false" ]]; then
  echo "MINECRAFT_DEFER_START must be true or false." >&2
  exit 1
fi
if [[ ! "${WEBSITE_IP:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "WEBSITE_IP must be the website VM's LAN IPv4 address." >&2
  exit 1
fi
IFS=. read -r -a OCTETS <<< "${WEBSITE_IP}"
for OCTET in "${OCTETS[@]}"; do
  if (( 10#${OCTET} > 255 )); then
    echo "WEBSITE_IP contains an invalid IPv4 octet." >&2
    exit 1
  fi
done
if [[ ! "${MINECRAFT_CONSOLE_PUBLIC_KEY:-}" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] ||
   [[ "${MINECRAFT_CONSOLE_PUBLIC_KEY}" == *$'\n'* || "${MINECRAFT_CONSOLE_PUBLIC_KEY}" == *$'\r'* ]]; then
  echo "Supply a single Ed25519 public key in MINECRAFT_CONSOLE_PUBLIC_KEY." >&2
  exit 1
fi
if ! id mcconsole >/dev/null 2>&1; then
  useradd --system --gid minecraft --home-dir /nonexistent \
    --no-create-home --shell /usr/bin/bash mcconsole
fi
passwd --lock mcconsole >/dev/null
install -d -o root -g root -m 0755 /usr/local/libexec /etc/ssh/authorized_keys
printf 'from="%s",restrict %s\n' "${WEBSITE_IP}" "${MINECRAFT_CONSOLE_PUBLIC_KEY}" \
  > /etc/ssh/authorized_keys/mcconsole
chown root:root /etc/ssh/authorized_keys/mcconsole
chmod 0644 /etc/ssh/authorized_keys/mcconsole

cat > /usr/local/libexec/blockhost-minecraft-start <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
rm -f /run/minecraft/console
mkfifo -m 0620 /run/minecraft/console
# Keep the pipe open in both directions so console input never gets a transient EOF.
exec 3<>/run/minecraft/console
read -r -a JAVA_ARGUMENTS <<< "${JAVA_OPTS:--Xms1G -Xmx3G}"
exec /usr/lib/jvm/java-25-openjdk/bin/java "${JAVA_ARGUMENTS[@]}" \
  -jar "${SERVER_JAR:-server.jar}" nogui <&3
EOF
cat > /usr/local/libexec/blockhost-minecraft-console <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${SSH_ORIGINAL_COMMAND:-}" in
  logs)
    systemctl show minecraft.service -p ActiveState --value
    if [[ -f /srv/minecraft/logs/latest.log ]]; then
      tail -c 65536 /srv/minecraft/logs/latest.log | tail -n 200
    else
      echo "No Minecraft log file has been created yet."
    fi
    ;;
  status)
    systemctl show minecraft.service -p ActiveState --value
    ;;
  command)
    systemctl is-active --quiet minecraft.service
    IFS= read -r command
    if [[ -z "${command}" || "${#command}" -gt 512 || "${command}" =~ [[:cntrl:]] ]]; then
      echo "Supply one Minecraft command of 1-512 characters." >&2
      exit 1
    fi
    if IFS= read -r extra; then
      echo "Only one command is allowed per request." >&2
      exit 1
    fi
    test -p /run/minecraft/console
    timeout 5 /bin/bash -c 'printf "%s\n" "$1" > /run/minecraft/console' _ "${command}"
    ;;
  start|stop|restart)
    sudo -A /usr/bin/systemctl "${SSH_ORIGINAL_COMMAND}" minecraft.service
    ;;
  *)
    echo "Only Minecraft console operations are permitted." >&2
    exit 1
    ;;
esac
EOF
chmod 0755 /usr/local/libexec/blockhost-minecraft-start \
  /usr/local/libexec/blockhost-minecraft-console
cat > /etc/ssh/sshd_config.d/20-blockhost-console.conf <<'EOF'
AllowUsers mcconsole
Match User mcconsole
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    AuthenticationMethods publickey
    ForceCommand /usr/local/libexec/blockhost-minecraft-console
    DisableForwarding yes
    PermitTTY no
Match all
EOF
cat > /etc/sudoers.d/minecraft-console <<'EOF'
mcconsole ALL=(root) NOPASSWD: /usr/bin/systemctl start minecraft.service, /usr/bin/systemctl stop minecraft.service, /usr/bin/systemctl restart minecraft.service
EOF
chmod 0440 /etc/sudoers.d/minecraft-console
visudo --check --file=/etc/sudoers.d/minecraft-console
/usr/bin/sshd -t

install -d -o root -g root -m 0755 /etc/systemd/system/minecraft.service.d
cat > /etc/systemd/system/minecraft.service.d/zz-console.conf <<'EOF'
[Service]
RuntimeDirectory=minecraft
RuntimeDirectoryMode=0750
ExecStart=
ExecStart=/usr/local/libexec/blockhost-minecraft-start
ReadWritePaths=/srv/minecraft /run/minecraft
EOF
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/minecraft.service
systemctl reload sshd.service
if [[ "${MINECRAFT_DEFER_START:-false}" == "false" ]]; then
  systemctl restart minecraft.service
fi
echo "Restricted Minecraft console configured; no RCON port was enabled."
