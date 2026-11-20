#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { isIP } = require("node:net");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

function validate(input) {
  if (!input || typeof input !== "object" || input.eulaAccepted !== true ||
      typeof input.eulaAcceptedAt !== "string" || !Number.isFinite(Date.parse(input.eulaAcceptedAt)) ||
      !/^[a-f0-9-]{36}$/.test(input.jobId || "") ||
      !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(input.hostname || "") ||
      !Number.isInteger(input.ramMb) || input.ramMb < 2048 || input.ramMb > 8192 || input.ramMb % 256 ||
      !Number.isInteger(input.diskGb) || input.diskGb < 32 || input.diskGb > 64 ||
      !/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(input.publicKey || "") ||
      !/^[a-f0-9]{64}$/i.test(input.forwardingSecret || "") ||
      ["websiteIp", "sftpIp", "velocityIp"].some((key) => isIP(input[key]) !== 4)) throw new Error("Invalid backend creation request.");
  return input;
}
function configure(input) {
  validate(input);
  if (process.getuid() !== 0 || fs.existsSync("/etc/minecraft/provisioned.json")) throw new Error("Run once, as root, on an unused backend.");
  const log = fs.openSync("/var/log/blockhost-provision.log", "a", 0o600);
  function run(command, args, env = {}, allowNoChange = false) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 480000, maxBuffer: 1048576,
      env: { ...process.env, ...env } });
    fs.writeSync(log, `${command}: ${result.stdout || ""}${result.stderr || ""}\n`);
    if (result.error || (result.status !== 0 && !(allowNoChange && result.status === 1 && result.stdout.includes("NOCHANGE")))) {
      throw new Error("Backend configuration step failed: " + command);
    }
    return result.stdout.trim();
  }
  const secretFile = "/run/blockhost-forwarding-" + crypto.randomUUID();
  try {
    const source = run("/usr/bin/findmnt", ["-n", "-o", "SOURCE", "/"]);
    const partition = source.match(/^\/dev\/((?:sd|vd|hd)[a-z]+|nvme\d+n\d+)p?(\d+)$/);
    if (!partition) throw new Error("Unsupported backend root partition.");
    run("/usr/bin/growpart", ["/dev/" + partition[1], partition[2]], {}, true);
    const filesystem = run("/usr/bin/findmnt", ["-n", "-o", "FSTYPE", "/"]);
    if (filesystem !== "ext4") throw new Error("Expected an ext4 root filesystem.");
    run("/usr/bin/resize2fs", [source]);
    const capacity = fs.statfsSync("/");
    if (capacity.blocks * capacity.bsize < (input.diskGb - 4) * 1024 ** 3) throw new Error("Root filesystem did not grow to the requested disk size.");
    fs.writeFileSync(secretFile, input.forwardingSecret + "\n", { mode: 0o600, flag: "wx" });
    const env = {
      MINECRAFT_EULA_ACCEPTED: "true", MINECRAFT_DEFER_START: "true",
      MINECRAFT_RAM_MB: String(input.ramMb), MINECRAFT_HOSTNAME: input.hostname,
      VELOCITY_FORWARDING_SECRET_FILE: secretFile, VELOCITY_GATEWAY_IP: input.velocityIp,
      WEBSITE_IP: input.websiteIp, MINECRAFT_CONSOLE_PUBLIC_KEY: input.publicKey,
      SFTP_GATEWAY_IP: input.sftpIp, MINECRAFT_FILES_PUBLIC_KEY: input.publicKey,
      MANAGEMENT_HELPER_FILE: "/usr/local/libexec/blockhost-template/minecraft-management.cjs",
    };
    for (const helper of ["arch-paper-backend-setup.sh", "arch-minecraft-console-setup.sh", "arch-minecraft-management-setup.sh"]) {
      run("/bin/bash", ["/usr/local/libexec/blockhost-template/" + helper], env);
    }
    fs.writeFileSync("/etc/minecraft/eula-acceptance.txt",
      `accepted_at=${input.eulaAcceptedAt}\nsource=website-job:${input.jobId}\nurl=https://www.minecraft.net/en-us/eula\n`, { mode: 0o600 });
    fs.writeFileSync("/etc/minecraft/provisioned.json", JSON.stringify({ jobId: input.jobId, hostname: input.hostname }), { mode: 0o600 });
    run("/usr/bin/systemctl", ["start", "minecraft.service"]);
  } finally { fs.rmSync(secretFile, { force: true }); fs.closeSync(log); }
}
module.exports = { validate };
if (require.main === module) {
  (async () => {
    let data = "";
    for await (const chunk of process.stdin) {
      data += chunk;
      if (data.length > 16384) throw new Error("Backend request exceeds its size limit.");
    }
    configure(JSON.parse(data));
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
