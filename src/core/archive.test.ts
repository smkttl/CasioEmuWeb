import { describe, expect, it } from "vitest";
import { readModelArchive } from "./archive";

interface ZipFile {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  uncompressedSize?: number;
  flags?: number;
  externalAttributes?: number;
}

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function buildZip(files: ZipFile[]) {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of files) {
    const name = encoder.encode(entry.name);
    const method = entry.method ?? 0;
    const data = entry.data;
    const flags = entry.flags ?? 0x800;
    const checksum = crc32(data);
    const uncompressedSize = entry.uncompressedSize ?? data.byteLength;
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(checksum),
      ...u32(data.byteLength),
      ...u32(uncompressedSize),
      ...u16(name.byteLength),
      ...u16(0),
      ...name,
      ...data,
    ]);
    localChunks.push(local);
    const central = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(0x031e),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(checksum),
      ...u32(data.byteLength),
      ...u32(uncompressedSize),
      ...u16(name.byteLength),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(entry.externalAttributes ?? 0),
      ...u32(offset),
      ...name,
    ]);
    centralChunks.push(central);
    offset += local.byteLength;
  }

  const directorySize = centralChunks.reduce((sum, entry) => sum + entry.byteLength, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(directorySize),
    ...u32(offset),
    ...u16(0),
  ]);
  const chunks = [...localChunks, ...centralChunks, end];
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return output;
}

async function archive(files: ZipFile[]) {
  const bytes = buildZip(files);
  return {
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  } as Blob;
}

describe("ZIP model archives", () => {
  it("reads stored and deflated entries", async () => {
    const deflated = Uint8Array.from(
      "cb48cdc9c95748cecf2d284a2d2e4e4d0100".match(/../g) ?? [],
      (byte) => Number.parseInt(byte, 16),
    );
    const source = await readModelArchive(
      await archive([
        { name: "config.json", data: encoder.encode("{}") },
        { name: "rom.bin", data: deflated, method: 8, uncompressedSize: 16 },
        { name: "folder/", data: new Uint8Array() },
      ]),
    );
    expect(source.files.map((item) => item.path)).toEqual(["config.json", "rom.bin"]);
    expect(new TextDecoder().decode(source.files[1].bytes)).toBe("hello compressed");
  });

  it("ignores macOS metadata and empty entries", async () => {
    const source = await readModelArchive(
      await archive([
        { name: "__MACOSX/._config.json", data: new Uint8Array([1]) },
        { name: "empty.bin", data: new Uint8Array() },
        { name: "rom.bin", data: new Uint8Array([1, 2]) },
      ]),
    );
    expect(source.files.map((item) => item.path)).toEqual(["rom.bin"]);
  });

  it("rejects symlink entries", async () => {
    await expect(
      readModelArchive(
        await archive([
          { name: "link", data: encoder.encode("target"), externalAttributes: 0xa1ff0000 },
        ]),
      ),
    ).rejects.toThrow("Symbolic links");
  });

  it("rejects encrypted entries", async () => {
    await expect(
      readModelArchive(
        await archive([{ name: "rom.bin", data: new Uint8Array([1]), flags: 0x801 }]),
      ),
    ).rejects.toThrow("Encrypted");
  });

  it("rejects non-ZIP data and truncated archives", async () => {
    await expect(
      readModelArchive({
        size: 9,
        arrayBuffer: async () => new TextEncoder().encode("not a zip").buffer,
      } as Blob),
    ).rejects.toThrow("not a valid ZIP");

    const valid = buildZip([{ name: "rom.bin", data: new Uint8Array([1]) }]);
    await expect(
      readModelArchive({
        size: valid.length - 8,
        arrayBuffer: async () => valid.slice(0, valid.length - 8).buffer,
      } as Blob),
    ).rejects.toThrow("not a valid ZIP");
  });
});
