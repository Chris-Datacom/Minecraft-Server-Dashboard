import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import test, { TestContext } from "node:test";
import { minecraftStatus } from "./minecraft-status";

function length(value: number): Buffer {
  const bytes = [];
  do {
    const byte = value & 127;
    value >>>= 7;
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}
function frame(text: string): Buffer {
  const data = Buffer.from(text);
  const packet = Buffer.concat([Buffer.from([0]), length(data.length), data]);
  return Buffer.concat([length(packet.length), packet]);
}
async function probe(t: TestContext, response: Buffer, fragmented = false, expectedBackend?: string) {
  const server = createServer((socket) => {
    socket.once("data", () => {
      if (fragmented) {
        socket.write(response.subarray(0, 1));
        setTimeout(() => socket.end(response.subarray(1)), 5);
      } else socket.end(response);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener.");
  return minecraftStatus("127.0.0.1", address.port, "test.krumpy.xyz", expectedBackend);
}
test("player status handles fragmented Minecraft packets without inventing player counts", async (t) => {
  assert.deepEqual(await probe(t, frame(JSON.stringify({ players: { online: 3, max: 20 } })), true), { online: 3, max: 20 });
});
test("player status rejects malformed, truncated, oversized and invalid-count responses", async (t) => {
  for (const response of [
    frame("not json"), Buffer.from([10, 0]), length(65531),
    Buffer.from([128, 128, 128, 128, 16]),
    frame(JSON.stringify({ players: { online: -1, max: 20 } })),
    frame(JSON.stringify({ players: { online: "3", max: 20 } })),
  ]) await assert.rejects(probe(t, response));
});
test("provisioning readiness requires the expected backend, not a generic proxy ping", async (t) => {
  for (const description of ["Velocity", "Blockhost - other.krumpy.xyz", undefined]) {
    await assert.rejects(probe(t, frame(JSON.stringify({ players: { online: 0, max: 100 }, description })), false, "new.krumpy.xyz"), /different backend/);
  }
  assert.deepEqual(await probe(t, frame(JSON.stringify({ players: { online: 0, max: 20 },
    description: { text: "Blockhost - ", extra: [{ text: "new.krumpy.xyz" }] } })), true, "new.krumpy.xyz"), { online: 0, max: 20 });
});
