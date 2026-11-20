#!/usr/bin/env node
"use strict";
const { isIP } = require("node:net");
const { spawnSync } = require("node:child_process");

function commands(grants, now = Date.now()) {
  if (!Array.isArray(grants) || grants.length > 2000) throw new Error("Provide at most 2000 IP access grants.");
  const addresses = new Map();
  for (const grant of grants) {
    if (!grant || typeof grant.ip !== "string" || grant.ip.includes("%") || !isIP(grant.ip) || !Number.isSafeInteger(grant.expiresAt)) throw new Error("Invalid IP access grant.");
    const remaining = Math.min(3600, Math.ceil((grant.expiresAt - now) / 1000));
    if (grant.expiresAt - now > 3605000) throw new Error("An IP access grant cannot exceed one hour.");
    if (remaining > 0) addresses.set(grant.ip, Math.max(addresses.get(grant.ip) || 0, remaining));
  }
  const lines = ["flush set inet blockhost_sftp clients4", "flush set inet blockhost_sftp clients6"];
  for (const [ip, seconds] of addresses) lines.push(`add element inet blockhost_sftp clients${isIP(ip)} { ${ip} timeout ${seconds}s }`);
  return lines.join("\n") + "\n";
}
async function main() {
  if (process.getuid() !== 0) throw new Error("Root is required to synchronize the SFTP firewall.");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 262144) throw new Error("The access request is too large.");
  }
  const script = commands(JSON.parse(input));
  const result = spawnSync("/usr/bin/nft", ["-f", "-"], { input: script, encoding: "utf8", timeout: 5000 });
  if (result.error || result.status !== 0) throw new Error("Could not synchronize the SFTP firewall.");
  process.stdout.write('{"synchronized":true}\n');
}
module.exports = { commands };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
