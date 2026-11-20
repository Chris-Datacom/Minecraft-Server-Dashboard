#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]] || [[ ! -r /etc/os-release ]] ||
   ! grep -Eq '^ID="?arch"?$' /etc/os-release; then
  echo "Run as root on the verified Arch Paper template build VM." >&2
  exit 1
fi
if [[ -e /srv/minecraft/eula.txt || -e /srv/minecraft/server.properties ||
      -e /etc/minecraft/provisioned.json ]] ||
   [[ "$(systemctl show minecraft.service -p ActiveState --value)" != "inactive" ]]; then
  echo "Backend configuration, EULA state, or an active Minecraft service prevents sealing." >&2
  exit 1
fi
test -f /var/lib/cloud/instance/boot-finished
test -f /srv/minecraft/server.jar
test -x /usr/local/libexec/blockhost-provision-backend.cjs
/usr/bin/sshd -t

cloud-init clean --logs --machine-id --seed --configs network
rm -f -- \
  /etc/NetworkManager/system-connections/default-ethernet.nmconnection \
  /etc/NetworkManager/system-connections/blockhost-build.nmconnection \
  /etc/NetworkManager/system-connections/cloud-init-eth0.nmconnection \
  /etc/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key.pub \
  /etc/ssh/ssh_host_rsa_key /etc/ssh/ssh_host_rsa_key.pub \
  /etc/ssh/ssh_host_ecdsa_key /etc/ssh/ssh_host_ecdsa_key.pub \
  /root/.ssh/authorized_keys /home/mcdeploy/.ssh/authorized_keys \
  /root/.bash_history /home/mcdeploy/.bash_history
if [[ -f /var/lib/dbus/machine-id && ! -L /var/lib/dbus/machine-id ]]; then
  rm -f -- /var/lib/dbus/machine-id
  ln -s /etc/machine-id /var/lib/dbus/machine-id
fi
systemctl stop systemd-random-seed.service
rm -f -- /var/lib/systemd/random-seed
sync
test "$(cat /etc/machine-id)" = uninitialized
test ! -e /home/mcdeploy/.ssh/authorized_keys
test ! -e /etc/ssh/ssh_host_ed25519_key
echo "Clone identity, injected maintenance keys, network state, and Cloud-Init cache cleaned."
echo "Shut down now; do not boot this VM again before converting it to a template."
