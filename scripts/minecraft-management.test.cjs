const test = require("node:test");
const assert = require("node:assert/strict");
const { readSettings, updateSettings } = require("./minecraft-management.cjs");
const { commands } = require("./sftp-access.cjs");
const source = "# Keep this comment\nmotd=A\\: Minecraft\\u0020server\nmax-players=20\ngamemode=survival\ndifficulty=easy\nview-distance=8\nsimulation-distance=6\nspawn-protection=16\nwhite-list=false\nallow-flight=false\nonline-mode=false\nserver-port=25565\n";

test("settings preserve protected properties and correctly round-trip escaped MOTDs", () => {
  assert.equal(readSettings(source).motd, "A: Minecraft server");
  const result = updateSettings(source, { motd: "Hello: \u2603", maxPlayers: 25, whitelist: true });
  assert.equal(readSettings(result.source).motd, "Hello: \u2603");
  assert.equal(readSettings(result.source).maxPlayers, 25);
  assert.match(result.source, /^online-mode=false$/m);
  assert.match(result.source, /^server-port=25565$/m);
  assert.ok(result.source.startsWith("# Keep this comment\n"));
});
test("settings reject network changes, command/control injection and invalid resource values", () => {
  for (const value of [
    { "online-mode": true }, { maxPlayers: 0 }, { viewDistance: 25 },
    { whitelist: "true" }, { motd: "Hello\nonline-mode=true" }, { difficulty: "hardcore" },
  ]) assert.throws(() => updateSettings(source, value));
});
test("continued Java properties are replaced as one setting without leaving stale continuation lines", () => {
  const continued = source.replace("motd=A\\: Minecraft\\u0020server", "motd=First\\\n  second");
  assert.equal(readSettings(continued).motd, "Firstsecond");
  const updated = updateSettings(continued, { motd: "New" }).source;
  assert.equal(readSettings(updated).motd, "New");
  assert.ok(!updated.includes("second"));
});
test("IP access transactions expire, distinguish IPv4/IPv6 and retain the longest shared-IP lease", () => {
  const now = 10000000;
  const result = commands([
    { ip: "203.0.113.8", expiresAt: now + 10000 },
    { ip: "203.0.113.8", expiresAt: now + 20000 },
    { ip: "2001:db8::8", expiresAt: now + 15000 },
    { ip: "203.0.113.9", expiresAt: now - 1 },
  ], now);
  assert.match(result, /clients4 \{ 203\.0\.113\.8 timeout 20s \}/);
  assert.match(result, /clients6 \{ 2001:db8::8 timeout 15s \}/);
  assert.ok(!result.includes("203.0.113.9"));
  assert.equal((result.match(/add element.*203\.0\.113\.8/g) || []).length, 1);
});
test("the privileged IP synchronizer rejects shell syntax, CIDRs, scoped IPv6 and excessive leases", () => {
  for (const ip of ["0.0.0.0/0", "203.0.113.1; flush ruleset", "::1%lo", "not-an-address"]) {
    assert.throws(() => commands([{ ip, expiresAt: 2000 }], 1000));
  }
  assert.throws(() => commands([{ ip: "203.0.113.1", expiresAt: 4000000 }], 1000));
  assert.equal(commands([], 1000), "flush set inet blockhost_sftp clients4\nflush set inet blockhost_sftp clients6\n");
});
