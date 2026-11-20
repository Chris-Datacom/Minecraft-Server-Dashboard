#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 || ! -f /etc/systemd/system/velocity.service ||
      ! -f /srv/velocity/velocity.toml ]]; then
  echo "Run as root on the configured Velocity gateway." >&2
  exit 1
fi
if [[ "${VELOCITY_RESTART_ACCEPTED:-}" != "true" ]]; then
  echo "Explicit approval for one Velocity restart is required." >&2
  exit 1
fi
install -d -o root -g root -m 0755 /usr/local/libexec /etc/systemd/system/velocity.service.d
cat > /usr/local/libexec/blockhost-velocity-start <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
rm -f -- /run/velocity/console
mkfifo -m 0600 /run/velocity/console
exec 3<>/run/velocity/console
exec /usr/lib/jvm/java-25-openjdk/bin/java -Xms256M -Xmx1G -XX:+UseG1GC \
  -jar /opt/velocity/velocity.jar <&3
EOF
chmod 0755 /usr/local/libexec/blockhost-velocity-start
cat > /etc/systemd/system/velocity.service.d/console.conf <<'EOF'
[Service]
RuntimeDirectory=velocity
RuntimeDirectoryMode=0700
ExecStart=
ExecStart=/usr/local/libexec/blockhost-velocity-start
ReadWritePaths=/srv/velocity /run/velocity
EOF
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/velocity.service
systemctl restart velocity.service
for ((attempt = 0; attempt < 50; attempt++)); do
  if [[ -p /run/velocity/console ]]; then break; fi
  sleep 0.1
done
systemctl is-active --quiet velocity.service
test -p /run/velocity/console
echo "Velocity console input configured; future route changes can use velocity reload."
