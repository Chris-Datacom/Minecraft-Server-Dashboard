#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "Error: $*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  die "Run this installer as root from the Arch live ISO."
fi

if [[ ! -r /etc/os-release ]]; then
  die "Cannot identify this operating system."
fi

source /etc/os-release
if [[ "${ID:-}" != "arch" ]]; then
  die "This installer supports the Arch Linux live environment only."
fi

if (( $# > 1 )); then
  die "Usage: $0 [/dev/disk]"
fi

for command_name in lsblk parted mkfs.ext4 pacstrap genfstab arch-chroot; do
  command -v "${command_name}" >/dev/null 2>&1 || die "Required command not found: ${command_name}"
done

DISK="${1:-}"
if [[ -z "${DISK}" ]]; then
  lsblk -dpno NAME,SIZE,MODEL,TYPE
  read -r -p "Target disk to erase (for example /dev/sda): " DISK
fi

[[ "${DISK}" == /dev/* ]] || die "Target must be a device under /dev."
[[ -b "${DISK}" ]] || die "Target is not a block device: ${DISK}"
[[ "$(lsblk -dnro TYPE "${DISK}")" == "disk" ]] || die "Target must be a whole disk: ${DISK}"

if lsblk -nrpo MOUNTPOINT "${DISK}" | awk 'NF { found=1 } END { exit !found }'; then
  die "A partition on ${DISK} is mounted; refusing to erase it."
fi

echo
echo "WARNING: all data on ${DISK} will be erased."
lsblk -dpo NAME,SIZE,MODEL "${DISK}"
read -r -p "Type ERASE to continue: " confirmation
[[ "${confirmation}" == "ERASE" ]] || die "Installation cancelled."

if [[ "${DISK##*/}" =~ [0-9]$ ]]; then
  ROOT_PART="${DISK}p2"
else
  ROOT_PART="${DISK}2"
fi

timedatectl set-ntp true
pacman -Sy --noconfirm archlinux-keyring

parted --script "${DISK}" \
  mklabel gpt \
  mkpart bios_grub 1MiB 3MiB \
  set 1 bios_grub on \
  mkpart primary ext4 3MiB 100%
partprobe "${DISK}"
udevadm settle

[[ -b "${ROOT_PART}" ]] || die "Expected root partition was not created: ${ROOT_PART}"
mkfs.ext4 -F -L root "${ROOT_PART}"
mount "${ROOT_PART}" /mnt

pacstrap -K /mnt \
  base \
  linux \
  linux-firmware \
  grub \
  cloud-init \
  qemu-guest-agent \
  openssh \
  networkmanager \
  jdk21-openjdk \
  sudo \
  ca-certificates \
  curl

genfstab -U /mnt >> /mnt/etc/fstab

arch-chroot /mnt /bin/bash -euo pipefail <<CHROOT
ln -sf /usr/share/zoneinfo/UTC /etc/localtime
sed -i 's/^#en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
locale-gen
printf 'LANG=en_US.UTF-8\n' > /etc/locale.conf
printf 'blockhost-arch-template\n' > /etc/hostname
cat > /etc/hosts <<'HOSTS'
127.0.0.1 localhost
::1       localhost
127.0.1.1 blockhost-arch-template.localdomain blockhost-arch-template
HOSTS

install -d -m 0755 /etc/NetworkManager/system-connections
cat > /etc/NetworkManager/system-connections/default-ethernet.nmconnection <<'NETWORK'
[connection]
id=default-ethernet
type=ethernet
autoconnect=true
autoconnect-priority=-999

[ipv4]
method=auto

[ipv6]
method=auto
NETWORK
chmod 0600 /etc/NetworkManager/system-connections/default-ethernet.nmconnection

install -d -m 0755 /etc/cloud/cloud.cfg.d
cat > /etc/cloud/cloud.cfg.d/99-proxmox.cfg <<'CLOUD'
datasource_list: [ NoCloud, ConfigDrive ]
preserve_hostname: false
ssh_deletekeys: true
ssh_genkeytypes: [ ed25519, rsa ]
CLOUD

grub-install --target=i386-pc --recheck "${DISK}"
grub-mkconfig -o /boot/grub/grub.cfg
systemctl enable NetworkManager sshd qemu-guest-agent
systemctl enable cloud-init-local.service cloud-init.service cloud-config.service cloud-final.service
cloud-init clean --logs
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
install -d -m 0755 /var/lib/dbus
ln -s /etc/machine-id /var/lib/dbus/machine-id
CHROOT

umount -R /mnt
sync

echo
echo "Arch template installation is complete."
echo "In Proxmox, detach the installer ISO, add a Cloud-Init drive, and boot from the disk."
echo "Verify SSH, QEMU guest-agent, and Cloud-Init on a test clone before converting this VM to a template."
