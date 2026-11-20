import { createConnection } from "node:net";

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 127;
    remaining >>>= 7;
    if (remaining) byte |= 128;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}
function readVarint(data: Buffer, offset = 0): { value: number; bytes: number } | null {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    if (offset + index >= data.length) return null;
    const byte = data[offset + index];
    if (index === 4 && (byte & 240)) throw new Error("Invalid Minecraft packet length.");
    value |= (byte & 127) << (index * 7);
    if (!(byte & 128)) {
      if (value < 0) throw new Error("Invalid Minecraft packet length.");
      return { value, bytes: index + 1 };
    }
  }
  throw new Error("Invalid Minecraft packet length.");
}

export function minecraftStatus(host: string, port: number, hostname: string): Promise<{ online: number; max: number }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let data = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error, players?: { online: number; max: number }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(players!);
    };
    socket.setTimeout(4000, () => finish(new Error("Minecraft status timed out.")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => { if (!settled) finish(new Error("Minecraft closed its status connection.")); });
    socket.on("connect", () => {
      const address = Buffer.from(hostname, "utf8");
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      const handshake = Buffer.concat([varint(0), varint(-1), varint(address.length), address, portBytes, varint(1)]);
      socket.write(Buffer.concat([varint(handshake.length), handshake, Buffer.from([1, 0])]));
    });
    socket.on("data", (chunk: Buffer) => {
      try {
        data = Buffer.concat([data, chunk]);
        if (data.length > 65536) throw new Error("Minecraft status response exceeded its limit.");
        const length = readVarint(data);
        if (!length) return;
        if (length.value > 65530) throw new Error("Minecraft status packet is too large.");
        if (data.length < length.bytes + length.value) return;
        const packet = data.subarray(length.bytes, length.bytes + length.value);
        const id = readVarint(packet);
        if (!id || id.value !== 0) throw new Error("Unexpected Minecraft status packet.");
        const size = readVarint(packet, id.bytes);
        if (!size || id.bytes + size.bytes + size.value !== packet.length) throw new Error("Malformed Minecraft status response.");
        const result: unknown = JSON.parse(packet.subarray(id.bytes + size.bytes).toString("utf8"));
        if (!result || typeof result !== "object" || !("players" in result)) throw new Error("No backend player status is available.");
        const players = result.players;
        if (!players || typeof players !== "object" || !("online" in players) || !("max" in players) ||
            typeof players.online !== "number" || !Number.isInteger(players.online) || players.online < 0 ||
            typeof players.max !== "number" || !Number.isInteger(players.max) || players.max < 0) throw new Error("Invalid Minecraft player count.");
        finish(undefined, { online: players.online, max: players.max });
      } catch (error) { finish(error instanceof Error ? error : new Error("Invalid Minecraft status response.")); }
    });
  });
}
