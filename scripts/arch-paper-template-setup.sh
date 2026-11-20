#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]] || [[ ! -r /etc/os-release ]] ||
   ! grep -Eq '^ID="?arch"?$' /etc/os-release; then
  echo "Run as root on a fresh installed Arch template build VM." >&2
  exit 1
fi
if [[ -e /srv/minecraft/eula.txt || -e /srv/minecraft/server.properties ||
      -e /etc/minecraft/provisioned.json ]]; then
  echo "This VM has backend configuration or EULA state; refusing to bake it into a template." >&2
  exit 1
fi
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HELPERS=(
  arch-minecraft-template-setup.sh
  arch-paper-backend-setup.sh
  arch-minecraft-console-setup.sh
  arch-minecraft-management-setup.sh
  minecraft-management.cjs
  arch-paper-template-seal.sh
)
for HELPER in "${HELPERS[@]}" provision-backend.cjs; do
  if [[ ! -f "${SOURCE_DIR}/${HELPER}" ]]; then
    echo "Missing template input: ${HELPER}" >&2
    exit 1
  fi
done

pacman -Syu --needed --noconfirm \
  jdk25-openjdk nodejs curl nftables cloud-guest-utils
ARCH_ROOT=/ ROOT_SSH_POLICY=disabled bash "${SOURCE_DIR}/arch-minecraft-template-setup.sh"
archlinux-java set java-25-openjdk
systemctl stop minecraft.service
printf 'HostKey /etc/ssh/ssh_host_ed25519_key\n' > /etc/ssh/sshd_config.d/15-blockhost-host-key.conf
/usr/bin/sshd -t

install -d -o root -g root -m 0755 /usr/local/libexec/blockhost-template
for HELPER in "${HELPERS[@]}"; do
  install -o root -g root -m 0755 "${SOURCE_DIR}/${HELPER}" \
    "/usr/local/libexec/blockhost-template/${HELPER}"
done
install -o root -g root -m 0755 "${SOURCE_DIR}/provision-backend.cjs" \
  /usr/local/libexec/blockhost-provision-backend.cjs
chown minecraft:minecraft /srv/minecraft
chmod 2770 /srv/minecraft

PAPER_SHA256="c86baf83b1fb0eb0d572f39484c242210896c6adf9cc9342d5c16c4de70c9bdc"
if [[ ! -e /srv/minecraft/server.jar ]]; then
  DOWNLOAD="$(mktemp)"
  trap 'rm -f -- "${DOWNLOAD}"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 \
    --user-agent 'Blockhost/0.1 (https://github.com/Krumpy1337/Minecraft-Server-Dashboard)' \
    --output "${DOWNLOAD}" \
    "https://fill-data.papermc.io/v1/objects/${PAPER_SHA256}/paper-26.3-256.jar"
  printf '%s  %s\n' "${PAPER_SHA256}" "${DOWNLOAD}" | sha256sum --check --status
  install -o root -g minecraft -m 0640 "${DOWNLOAD}" /srv/minecraft/server.jar
fi
printf '%s  %s\n' "${PAPER_SHA256}" /srv/minecraft/server.jar | sha256sum --check
node --check /usr/local/libexec/blockhost-provision-backend.cjs
node --check /usr/local/libexec/blockhost-template/minecraft-management.cjs
for HELPER in /usr/local/libexec/blockhost-template/*.sh; do
  bash -n "${HELPER}"
done
command -v growpart resize2fs
systemd-analyze verify /etc/systemd/system/minecraft.service
test ! -e /srv/minecraft/eula.txt
test ! -e /srv/minecraft/server.properties
test "$(systemctl is-active minecraft.service)" = inactive
echo "Paper template inputs installed; no EULA accepted and Minecraft remains inactive."
echo "Reboot, verify the guest, and clean clone identity/keys before converting it to a template."
