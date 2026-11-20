const assert = require("node:assert/strict");
const test = require("node:test");
const { parseEnv } = require("node:util");
const { updateEnvironment } = require("./install-provisioner.cjs");

test("beta deployment preserves saved OAuth/encryption settings and refuses ambiguous overrides", () => {
  const original = '# saved settings\nDISCORD_CLIENT_SECRET="keep # this"\nSERVER_CREDENTIALS_KEY=existing\nHOSTING_ENABLED=true\n';
  const updated = parseEnv(updateEnvironment(original, {
    HOSTING_ENABLED: "false", HOSTING_IP_START: "10.0.0.201",
  }));
  assert.equal(updated.DISCORD_CLIENT_SECRET, "keep # this");
  assert.equal(updated.SERVER_CREDENTIALS_KEY, "existing");
  assert.equal(updated.HOSTING_ENABLED, "false");
  assert.equal(updated.HOSTING_IP_START, "10.0.0.201");
  assert.throws(() => updateEnvironment(original + "HOSTING_ENABLED=true\n", { HOSTING_ENABLED: "false" }), /conflicting/);
  assert.throws(() => updateEnvironment(original, { HOSTING_ENABLED: "false\nOTHER=value" }), /Invalid/);
});
