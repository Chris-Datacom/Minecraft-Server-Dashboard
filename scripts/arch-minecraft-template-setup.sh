#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this helper as root." >&2
  exit 1
fi

ARCH_ROOT="${ARCH_ROOT:-/mnt}"
if [[ ! -r "${ARCH_ROOT}/etc/os-release" ]] || ! grep -Eq '^ID="?arch"?$' "${ARCH_ROOT}/etc/os-release"; then
  echo "ARCH_ROOT must point to an installed Arch Linux system." >&2
  exit 1
fi
if [[ "${ARCH_ROOT}" != "/" && ! -x /usr/bin/arch-chroot ]]; then
  echo "arch-chroot is required; run this from the Arch ISO." >&2
  exit 1
fi

ROOT_SSH_POLICY="${ROOT_SSH_POLICY:-disabled}"
if [[ "${ROOT_SSH_POLICY}" != "disabled" && "${ROOT_SSH_POLICY}" != "password" ]]; then
  echo "ROOT_SSH_POLICY must be 'disabled' or 'password'." >&2
  exit 1
fi

run_in_target() {
  if [[ "${ARCH_ROOT}" == "/" ]]; then
    /bin/bash -s -- "$@"
  else
    arch-chroot "${ARCH_ROOT}" /bin/bash -s -- "$@"
  fi
}

run_in_target "${ROOT_SSH_POLICY}" <<'CHROOT'
set -euo pipefail

ROOT_SSH_POLICY="$1"

pacman -S --needed --noconfirm \
  cloud-init \
  jdk21-openjdk \
  networkmanager \
  openssh \
  qemu-guest-agent \
  sudo

getent group minecraft >/dev/null || groupadd --system minecraft
if ! id minecraft >/dev/null 2>&1; then
  useradd --system --gid minecraft --home-dir /srv/minecraft \
    --no-create-home --shell /usr/bin/nologin minecraft
fi
if ! id mcdeploy >/dev/null 2>&1; then
  useradd --create-home --groups minecraft --shell /bin/bash mcdeploy
fi
usermod --append --groups minecraft mcdeploy
passwd --lock mcdeploy >/dev/null

install -d -o minecraft -g minecraft -m 2775 /srv/minecraft
install -d -o root -g root -m 0755 /etc/minecraft
if [[ ! -e /etc/minecraft/server.env ]]; then
  install -o root -g root -m 0644 /dev/null /etc/minecraft/server.env
  printf 'SERVER_JAR=server.jar\nJAVA_OPTS="-Xms1G -Xmx2G"\n' > /etc/minecraft/server.env
fi

install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d
if [[ "${ROOT_SSH_POLICY}" == "password" ]]; then
  cat > /etc/ssh/sshd_config.d/10-blockhost-template.conf <<'EOF'
PermitRootLogin yes
PasswordAuthentication yes
PubkeyAuthentication yes
AllowUsers root mcdeploy
EOF
else
  cat > /etc/ssh/sshd_config.d/10-blockhost-template.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers mcdeploy
EOF
  passwd --lock root >/dev/null
fi

cat > /etc/sudoers.d/minecraft-control <<'EOF'
mcdeploy ALL=(root) NOPASSWD: /usr/bin/systemctl start minecraft.service, /usr/bin/systemctl stop minecraft.service, /usr/bin/systemctl restart minecraft.service, /usr/bin/systemctl status minecraft.service
EOF
chmod 0440 /etc/sudoers.d/minecraft-control
visudo --check --file=/etc/sudoers.d/minecraft-control

cat > /etc/systemd/system/minecraft.service <<'EOF'
[Unit]
Description=Minecraft Java server
ConditionPathExists=/srv/minecraft/eula.txt
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=minecraft
Group=minecraft
WorkingDirectory=/srv/minecraft
Environment=SERVER_JAR=server.jar
Environment="JAVA_OPTS=-Xms1G -Xmx2G"
EnvironmentFile=-/etc/minecraft/server.env
ExecStartPre=/usr/bin/test -f /srv/minecraft/${SERVER_JAR}
ExecStartPre=/usr/bin/grep -qx eula=true /srv/minecraft/eula.txt
ExecStart=/usr/bin/java $JAVA_OPTS -jar $SERVER_JAR nogui
Restart=on-failure
RestartSec=10
LimitNOFILE=65535
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
ReadWritePaths=/srv/minecraft

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/cloud/cloud.cfg.d/99-blockhost-template.cfg <<'EOF'
datasource_list: [ NoCloud, ConfigDrive ]
preserve_hostname: false
ssh_deletekeys: true
ssh_genkeytypes: [ ed25519 ]
ssh_pwauth: false
disable_root: false
system_info:
  network:
    renderers: [ network-manager ]
    activators: [ network-manager ]
EOF

systemctl disable systemd-networkd.service systemd-networkd.socket \
  systemd-networkd-wait-online.service
systemctl mask systemd-networkd.service systemd-networkd-wait-online.service
systemctl enable NetworkManager.service sshd.service minecraft.service
systemctl enable cloud-init-main.service cloud-init-local.service \
  cloud-init-network.service cloud-config.service cloud-final.service
systemctl add-wants multi-user.target qemu-guest-agent.service
systemd-analyze verify /etc/systemd/system/minecraft.service
java --version
echo "Arch Minecraft guest template configured."
echo "Cloud-Init should set ciuser=mcdeploy and inject a unique SSH public key on each clone."
echo "The Minecraft EULA is intentionally not accepted; require explicit user consent before writing eula=true."
CHROOT
