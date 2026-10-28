import type { HardwareId, ModelRecord } from "./types";

const CEWRAM_MAGIC = "CEWRAM01";
const CEWPERS_MAGIC = "CEWPERS1";
const FORMAT_NAME = "CasioEmuWeb.Ram";
const FORMAT_VERSION = 1;
const HEADER_BYTES = 20;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_PERSISTENT_BYTES = 256 * 1024 * 1024;

export const MAX_RAM_FILE_BYTES =
  HEADER_BYTES + MAX_METADATA_BYTES + MAX_PERSISTENT_BYTES;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface RamFileIdentity {
  modelId: string;
  modelName: string;
  hardwareId: HardwareId;
}

export interface RamFileMetadata extends RamFileIdentity {
  format: typeof FORMAT_NAME;
  version: typeof FORMAT_VERSION;
  exportedAt: string;
}

export interface RamImportPreview {
  fileName: string;
  metadata: RamFileMetadata;
  payload: Uint8Array;
}

export class RamFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RamFileError";
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true,
  );
}

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
    true,
  );
}

function validatePersistentPayload(
  payload: Uint8Array,
  identity: Pick<RamFileIdentity, "hardwareId">,
) {
  if (payload.byteLength < 16 || ascii(payload, 0, 8) !== CEWPERS_MAGIC) {
    throw new RamFileError("The RAM data has an invalid persistent-state header.");
  }
  const hardwareId = readU32(payload, 8);
  const payloadLength = readU32(payload, 12);
  if (hardwareId !== identity.hardwareId) {
    throw new RamFileError("The RAM data does not match this calculator hardware.");
  }
  if (
    payloadLength > MAX_PERSISTENT_BYTES ||
    payload.byteLength !== payloadLength + 16
  ) {
    throw new RamFileError("The RAM data has an invalid length.");
  }
}

function parseMetadata(text: string): RamFileMetadata {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RamFileError("The RAM file metadata is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RamFileError("The RAM file metadata is invalid.");
  }
  const metadata = value as Partial<RamFileMetadata>;
  if (metadata.format !== FORMAT_NAME || metadata.version !== FORMAT_VERSION) {
    throw new RamFileError("This is not a supported CasioEmuWeb RAM file.");
  }
  if (
    typeof metadata.modelId !== "string" ||
    !metadata.modelId ||
    typeof metadata.modelName !== "string" ||
    !metadata.modelName ||
    !Number.isInteger(metadata.hardwareId) ||
    metadata.hardwareId! < 0 ||
    typeof metadata.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(metadata.exportedAt))
  ) {
    throw new RamFileError("The RAM file metadata is incomplete.");
  }
  return metadata as RamFileMetadata;
}

export function encodeRamFile(
  payload: Uint8Array,
  identity: RamFileIdentity,
  exportedAt = new Date(),
): Uint8Array {
  validatePersistentPayload(payload, identity);
  const metadata: RamFileMetadata = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    ...identity,
    exportedAt: exportedAt.toISOString(),
  };
  const metadataBytes = encoder.encode(JSON.stringify(metadata));
  if (metadataBytes.byteLength > MAX_METADATA_BYTES) {
    throw new RamFileError("The RAM file metadata is too large.");
  }
  const bytes = new Uint8Array(HEADER_BYTES + metadataBytes.byteLength + payload.byteLength);
  bytes.set(encoder.encode(CEWRAM_MAGIC), 0);
  writeU32(bytes, 8, FORMAT_VERSION);
  writeU32(bytes, 12, metadataBytes.byteLength);
  writeU32(bytes, 16, payload.byteLength);
  bytes.set(metadataBytes, HEADER_BYTES);
  bytes.set(payload, HEADER_BYTES + metadataBytes.byteLength);
  return bytes;
}

export function decodeRamFile(
  bytes: Uint8Array,
  expected: Pick<ModelRecord, "id" | "hardwareId">,
  fileName = "RAM file",
): RamImportPreview {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new RamFileError("The RAM file is truncated.");
  }
  if (ascii(bytes, 0, 8) !== CEWRAM_MAGIC) {
    throw new RamFileError("This is not a CasioEmuWeb RAM file.");
  }
  if (readU32(bytes, 8) !== FORMAT_VERSION) {
    throw new RamFileError("This RAM file version is not supported.");
  }
  const metadataLength = readU32(bytes, 12);
  const payloadLength = readU32(bytes, 16);
  if (
    metadataLength === 0 ||
    metadataLength > MAX_METADATA_BYTES ||
    payloadLength === 0 ||
    payloadLength > MAX_PERSISTENT_BYTES ||
    bytes.byteLength !== HEADER_BYTES + metadataLength + payloadLength
  ) {
    throw new RamFileError("The RAM file has an invalid length.");
  }

  let metadata: RamFileMetadata;
  try {
    metadata = parseMetadata(
      decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + metadataLength)),
    );
  } catch (error) {
    if (error instanceof RamFileError) throw error;
    throw new RamFileError("The RAM file metadata is not valid UTF-8.");
  }
  const payload = bytes.slice(HEADER_BYTES + metadataLength);
  validatePersistentPayload(payload, metadata);
  if (metadata.modelId !== expected.id) {
    throw new RamFileError(
      `This RAM file belongs to “${metadata.modelName}”, not the open model.`,
    );
  }
  if (metadata.hardwareId !== expected.hardwareId) {
    throw new RamFileError("This RAM file belongs to different calculator hardware.");
  }
  return { fileName, metadata, payload };
}

export function ramFileName(modelName: string, exportedAt = new Date()) {
  const safeModel =
    modelName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 80) || "model";
  const timestamp = exportedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  return `CasioEmuWeb-${safeModel}-${timestamp}.cewram`;
}
