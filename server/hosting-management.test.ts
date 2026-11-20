import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express from "express";
import { clientIp, filePath, publicKeys, readDirectoryChunk, uploadCounter } from "./hosting-management";

test("file paths cannot traverse the server root or inject control characters", () => {
  assert.equal(filePath("plugins/config.yml"), "/plugins/config.yml");
  assert.equal(filePath("/world/region"), "/world/region");
  for (const value of ["/../etc/passwd", "world/../../root", "world\\..\\etc", "world/\0", ["world"], "/./world"]) {
    assert.throws(() => filePath(value));
  }
});
test("handle-based directory listing treats SFTP EOF as completion, but surfaces permission failures", async () => {
  assert.equal(await readDirectoryChunk({
    readdir(_handle, callback) { callback(Object.assign(new Error("EOF"), { code: 1 }), []); },
  }, Buffer.from("handle")), false);
  await assert.rejects(readDirectoryChunk({
    readdir(_handle, callback) { callback(Object.assign(new Error("Permission denied"), { code: 3 }), []); },
  }, Buffer.from("handle")), /Permission denied/);
});
test("SFTP accepts real Ed25519 public keys only, with bounded and duplicate-free key lists", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const kind = Buffer.from("ssh-ed25519");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(kind.length);
  const keySize = Buffer.alloc(4);
  keySize.writeUInt32BE(raw.length);
  const key = "ssh-ed25519 " + Buffer.concat([size, kind, keySize, raw]).toString("base64");
  assert.deepEqual(publicKeys([key + " laptop"]), [key + " laptop"]);
  assert.deepEqual(publicKeys([]), []);
  for (const value of [[key, key + " other-comment"], ["ssh-ed25519 AAAA"], ["-----BEGIN OPENSSH PRIVATE KEY-----"], Array(6).fill(key), [key + "\0"]]) {
    assert.throws(() => publicKeys(value));
  }
});

test("streamed uploads enforce the actual browser and editor byte limits across chunks", async () => {
  const megabyte = Buffer.alloc(1024 * 1024);
  const sink = () => new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  await pipeline(Readable.from(Array(90).fill(megabyte)), uploadCounter(false), sink());
  await assert.rejects(pipeline(Readable.from([...Array(90).fill(megabyte), Buffer.alloc(1)]), uploadCounter(false), sink()), /size limit/);
  await pipeline(Readable.from([Buffer.alloc(256 * 1024)]), uploadCounter(true), sink());
  await assert.rejects(pipeline(Readable.from([Buffer.alloc(256 * 1024), Buffer.alloc(1)]), uploadCounter(true), sink()), /size limit/);
});

test("IP grants ignore untrusted forwarding headers and require valid tunnel client addresses", async (t) => {
  const previous = process.env.SFTP_TRUST_CLOUDFLARE;
  const app = express();
  app.set("trust proxy", 1);
  app.get("/", (req, res) => {
    try { res.json({ ip: clientIp(req) }); }
    catch { res.status(403).json({ error: "Unverified client address." }); }
  });
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(() => {
    if (previous === undefined) delete process.env.SFTP_TRUST_CLOUDFLARE;
    else process.env.SFTP_TRUST_CLOUDFLARE = previous;
    listener.closeIdleConnections();
    return new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener.");
  const url = `http://127.0.0.1:${address.port}/`;
  process.env.SFTP_TRUST_CLOUDFLARE = "false";
  const direct = await fetch(url, { headers: { "CF-Connecting-IP": "203.0.113.8", "X-Forwarded-For": "203.0.113.9" } });
  assert.deepEqual(await direct.json(), { ip: "127.0.0.1" });
  process.env.SFTP_TRUST_CLOUDFLARE = "true";
  for (const ip of ["", "not-an-address", "2001:db8::1%eth0"]) {
    assert.equal((await fetch(url, { headers: { "CF-Connecting-IP": ip } })).status, 403);
  }
  const mapped = await fetch(url, { headers: { "CF-Connecting-IP": "::ffff:203.0.113.8" } });
  assert.deepEqual(await mapped.json(), { ip: "203.0.113.8" });
});
