import { MAX_ARCHIVE_BYTES, MAX_FILE_COUNT, type ImportSource } from "./import";
import type { ModelFile } from "./types";

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;

interface ZipEntry {
  path: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readU16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function findEndRecord(view: DataView, bytes: Uint8Array) {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readU32(view, offset) === ZIP_END_SIGNATURE) return offset;
  }
  throw new Error("This file is not a valid ZIP archive.");
}

function decodeName(bytes: Uint8Array, flags: number) {
  if (flags & 0x800) return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function readEntries(view: DataView, bytes: Uint8Array): ZipEntry[] {
  const end = findEndRecord(view, bytes);
  const disk = readU16(view, end + 4);
  const centralDisk = readU16(view, end + 6);
  const entriesOnDisk = readU16(view, end + 8);
  const entries = readU16(view, end + 10);
  const directorySize = readU32(view, end + 12);
  const directoryOffset = readU32(view, end + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entries) {
    throw new Error("Multi-volume ZIP archives are not supported.");
  }
  if (entries > MAX_FILE_COUNT) {
    throw new Error(`The archive contains ${entries} entries; the limit is ${MAX_FILE_COUNT}.`);
  }
  if (directorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new Error("The archive directory is unexpectedly large.");
  }
  if (directoryOffset + directorySize > bytes.byteLength) {
    throw new Error("The ZIP central directory is truncated.");
  }

  const result: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.byteLength || readU32(view, cursor) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error("The ZIP central directory is corrupt.");
    }
    const flags = readU16(view, cursor + 8);
    const method = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const externalAttributes = readU32(view, cursor + 38);
    const localHeaderOffset = readU32(view, cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > bytes.byteLength) {
      throw new Error("The ZIP entry metadata is truncated.");
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = decodeName(nameBytes, flags).replaceAll("\\", "/");
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType === 0xa000) {
      throw new Error(`Symbolic links are not allowed in model archives (${path}).`);
    }
    if (flags & 1) {
      throw new Error(`Encrypted ZIP entries are not supported (${path}).`);
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported ZIP compression method ${method} for ${path}.`);
    }
    if (uncompressedSize > MAX_ARCHIVE_BYTES) {
      throw new Error(`Archive entry ${path} is too large after extraction.`);
    }
    result.push({
      path,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

async function decompressRaw(data: Uint8Array, method: number, expected: number) {
  if (method === 0) {
    if (data.byteLength !== expected) throw new Error("A stored ZIP entry has an invalid size.");
    return data;
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot extract compressed ZIP files. Select the model folder instead.");
  }
  const stream = new Response(data as BodyInit)
    .body!.pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  const output = new Uint8Array(await new Response(stream).arrayBuffer());
  if (output.byteLength !== expected) {
    throw new Error("A compressed ZIP entry has an invalid size.");
  }
  return output;
}

export async function readModelArchive(file: Blob, sourceName = "model.zip"): Promise<ImportSource> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`The archive is ${file.size} bytes; the limit is ${MAX_ARCHIVE_BYTES} bytes.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength < 22) throw new Error("This file is not a valid ZIP archive.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readEntries(view, bytes);
  let total = 0;
  const files: ModelFile[] = [];

  for (const entry of entries) {
    if (entry.path.endsWith("/")) continue;
    if (entry.path === "__MACOSX" || entry.path.startsWith("__MACOSX/")) continue;
    if (entry.uncompressedSize === 0 && entry.compressedSize === 0) continue;
    total += entry.uncompressedSize;
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error(`The extracted archive exceeds ${MAX_ARCHIVE_BYTES} bytes.`);
    }
    const local = entry.localHeaderOffset;
    if (local + 30 > bytes.byteLength || readU32(view, local) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error(`The local ZIP header for ${entry.path} is corrupt.`);
    }
    const nameLength = readU16(view, local + 26);
    const extraLength = readU16(view, local + 28);
    const dataStart = local + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.byteLength) {
      throw new Error(`The compressed data for ${entry.path} is truncated.`);
    }
    const contents = await decompressRaw(
      bytes.subarray(dataStart, dataEnd),
      entry.method,
      entry.uncompressedSize,
    );
    files.push({
      path: entry.path,
      bytes: contents,
      type: "",
    });
  }
  return { files, sourceName };
}
