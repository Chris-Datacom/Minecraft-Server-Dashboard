#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const fields = {
  motd: { property: "motd", type: "text" },
  maxPlayers: { property: "max-players", type: "integer", min: 1, max: 100 },
  gamemode: { property: "gamemode", values: ["survival", "creative", "adventure", "spectator"] },
  difficulty: { property: "difficulty", values: ["peaceful", "easy", "normal", "hard"] },
  viewDistance: { property: "view-distance", type: "integer", min: 2, max: 24 },
  simulationDistance: { property: "simulation-distance", type: "integer", min: 2, max: 24 },
  spawnProtection: { property: "spawn-protection", type: "integer", min: 0, max: 256 },
  whitelist: { property: "white-list", type: "boolean" },
  allowFlight: { property: "allow-flight", type: "boolean" },
};

function decodeProperty(value) {
  return value.replace(/\\u([a-fA-F0-9]{4})|\\(.)/g, (_match, unicode, escaped) =>
    unicode ? String.fromCharCode(parseInt(unicode, 16)) : ({ t: "\t", n: "\n", r: "\r", f: "\f" }[escaped] ?? escaped));
}
function encodeProperty(value) {
  return String(value).replace(/[\\:=#! \u0080-\uffff]/g, (char) =>
    char.charCodeAt(0) > 127 ? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}` : `\\${char}`);
}
function propertyLines(source) {
  const lines = source.split(/\r?\n/);
  const result = [];
  for (let index = 0; index < lines.length; index++) {
    const raw = [lines[index]];
    let logical = lines[index];
    while ((logical.match(/\\+$/)?.[0].length || 0) % 2 === 1 && index + 1 < lines.length) {
      raw.push(lines[++index]);
      logical = logical.slice(0, -1) + lines[index].trimStart();
    }
    const match = /^\s*([^#!\s:=]+)\s*[:=]\s*(.*)$/.exec(logical);
    result.push({ raw: raw.join("\n"), key: match?.[1], value: match ? decodeProperty(match[2]) : undefined });
  }
  return result;
}
function readSettings(source) {
  const properties = new Map(propertyLines(source).filter((line) => line.key).map((line) => [line.key, line.value]));
  const result = {};
  for (const [name, rule] of Object.entries(fields)) {
    const value = properties.get(rule.property);
    if (value === undefined) throw new Error(`Missing Minecraft property: ${rule.property}`);
    if (rule.type === "boolean") {
      if (value !== "true" && value !== "false") throw new Error(`Invalid Minecraft property: ${rule.property}`);
      result[name] = value === "true";
    } else if (rule.type === "integer") {
      if (!/^-?\d+$/.test(value)) throw new Error(`Invalid Minecraft property: ${rule.property}`);
      result[name] = Number(value);
    } else result[name] = value;
  }
  return result;
}
function updateSettings(source, settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || !Object.keys(settings).length) throw new Error("Provide settings to update.");
  for (const [name, value] of Object.entries(settings)) {
    const rule = fields[name];
    if (!rule) throw new Error("Unsupported server setting.");
    if (rule.type === "integer" && (!Number.isInteger(value) || value < rule.min || value > rule.max)) throw new Error(`${name} must be an integer from ${rule.min} to ${rule.max}.`);
    if (rule.type === "boolean" && typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
    if (rule.values && !rule.values.includes(value)) throw new Error(`Invalid ${name}.`);
    if (rule.type === "text" && (typeof value !== "string" || value.length > 120 || /[\x00-\x1f\x7f]/.test(value))) throw new Error("MOTD must be at most 120 characters without control characters.");
  }
  const existing = readSettings(source);
  const properties = new Map(Object.entries(settings).map(([name, value]) => [fields[name].property, encodeProperty(value)]));
  const lines = propertyLines(source).map((line) => properties.has(line.key) ? `${line.key}=${properties.get(line.key)}` : line.raw);
  return { source: lines.join("\n"), settings: { ...existing, ...settings } };
}
function serviceProperties() {
  return Object.fromEntries(execFileSync("/usr/bin/systemctl", ["show", "minecraft.service",
    "-p", "ActiveState", "-p", "InvocationID", "-p", "MemoryCurrent", "-p", "CPUUsageNSec",
    "-p", "ActiveEnterTimestampMonotonic"], { encoding: "utf8", timeout: 5000 }).trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}
function metrics() {
  const service = serviceProperties();
  const active = service.ActiveState === "active";
  const disk = fs.statfsSync("/srv/minecraft");
  const memory = Number(service.MemoryCurrent);
  if (active && !Number.isSafeInteger(memory)) throw new Error("Minecraft memory accounting is unavailable.");
  if (active && !/^\d+$/.test(service.CPUUsageNSec)) throw new Error("Minecraft CPU accounting is unavailable.");
  const uptime = Number(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  return {
    state: service.ActiveState, invocation: service.InvocationID,
    sampledAtMs: uptime * 1000, cpuUsageNs: active ? service.CPUUsageNSec : "0",
    memoryBytes: active ? memory : 0,
    uptimeSeconds: active ? Math.max(0, Math.floor(uptime - Number(service.ActiveEnterTimestampMonotonic) / 1000000)) : 0,
    disk: { totalBytes: disk.blocks * disk.bsize, usedBytes: (disk.blocks - disk.bfree) * disk.bsize, availableBytes: disk.bavail * disk.bsize },
  };
}
async function main() {
  const operation = process.argv[2];
  if (operation === "metrics") return metrics();
  const filename = "/srv/minecraft/server.properties";
  if (fs.lstatSync(filename).isSymbolicLink()) throw new Error("The settings file must not be a symbolic link.");
  if (fs.statSync(filename).size > 65536) throw new Error("The settings file is too large.");
  const source = fs.readFileSync(filename, "utf8");
  if (operation === "settings-get") return {
    state: serviceProperties().ActiveState, settings: readSettings(source),
    sha256: require("node:crypto").createHash("sha256").update(source).digest("hex"),
  };
  if (operation !== "settings-set") throw new Error("Unsupported management operation.");
  const state = serviceProperties().ActiveState;
  if (state !== "inactive" && state !== "failed") throw new Error("Stop Minecraft before saving settings.");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 16384) throw new Error("Settings request is too large.");
  }
  const request = JSON.parse(input);
  if (typeof request.expectedSha256 !== "string") throw new Error("A settings revision is required.");
  const crypto = require("node:crypto");
  if (crypto.createHash("sha256").update(source).digest("hex") !== request.expectedSha256) throw new Error("Settings changed since they were opened. Reload before saving.");
  const updated = updateSettings(source, request.settings);
  const temporary = filename + ".blockhost-" + crypto.randomUUID();
  try {
    fs.writeFileSync(temporary, updated.source, { mode: 0o660, flag: "wx" });
    fs.chmodSync(temporary, 0o660);
    if (fs.readFileSync(filename, "utf8") !== source) throw new Error("Settings changed while saving.");
    if (!["inactive", "failed"].includes(serviceProperties().ActiveState)) throw new Error("Minecraft started while saving settings.");
    fs.renameSync(temporary, filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { state, settings: updated.settings };
}
module.exports = { fields, readSettings, updateSettings, encodeProperty, decodeProperty };
if (require.main === module) main().then((result) => {
  process.stdout.write(JSON.stringify(result) + "\n");
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
