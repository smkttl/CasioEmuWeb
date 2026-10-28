import { describe, expect, it } from "vitest";
import {
  decodeRamFile,
  encodeRamFile,
  RamFileError,
  ramFileName,
  type RamFileIdentity,
} from "./ramFile";
import type { HardwareId, ModelRecord } from "./types";

const identity: RamFileIdentity = {
  modelId: "fx-991ex-123456789abc",
  modelName: "fx-991EX ClassWiz",
  hardwareId: 4,
};

const expected: Pick<ModelRecord, "id" | "hardwareId"> = {
  id: identity.modelId,
  hardwareId: 4,
};

function persistentPayload(
  bytes: number[],
  hardwareId: HardwareId = identity.hardwareId as HardwareId,
) {
  const payload = new Uint8Array(16 + bytes.length);
  payload.set(new TextEncoder().encode("CEWPERS1"), 0);
  new DataView(payload.buffer).setUint32(8, hardwareId, true);
  new DataView(payload.buffer).setUint32(12, bytes.length, true);
  payload.set(bytes, 16);
  return payload;
}

describe("CasioEmuWeb RAM files", () => {
  it("round-trips the persistent payload and model metadata", () => {
    const exportedAt = new Date("2026-10-28T14:30:00.000Z");
    const payload = persistentPayload([0, 1, 127, 255]);
    const file = encodeRamFile(payload, identity, exportedAt);
    const imported = decodeRamFile(file, expected, "restore.cewram");

    expect(imported.fileName).toBe("restore.cewram");
    expect(imported.metadata).toMatchObject({
      ...identity,
      exportedAt: exportedAt.toISOString(),
    });
    expect([...imported.payload]).toEqual([...payload]);
  });

  it("creates a sanitized model-and-time filename", () => {
    expect(
      ramFileName(
        "Fx-991EX / ClassWiz: 日本",
        new Date("2026-10-28T14:30:00.000Z"),
      ),
    ).toBe("CasioEmuWeb-Fx-991EX-ClassWiz-2026-10-28T14-30-00Z.cewram");
  });

  it("rejects a RAM file for another model or hardware", () => {
    const file = encodeRamFile(persistentPayload([1, 2, 3]), identity);
    expect(() =>
      decodeRamFile(file, { ...expected, id: "another-model" }),
    ).toThrow("belongs to");
    expect(() =>
      decodeRamFile(file, { ...expected, hardwareId: 5 }),
    ).toThrow("different calculator hardware");
  });

  it("rejects truncated, corrupt, and unsupported files", () => {
    const file = encodeRamFile(persistentPayload([1]), identity);
    expect(() =>
      decodeRamFile(file.subarray(0, 12), expected),
    ).toThrow(RamFileError);

    const corrupt = file.slice();
    corrupt[0] = 0;
    expect(() =>
      decodeRamFile(corrupt, expected),
    ).toThrow("not a CasioEmuWeb RAM file");

    const unsupported = file.slice();
    new DataView(unsupported.buffer).setUint32(8, 2, true);
    expect(() =>
      decodeRamFile(unsupported, expected),
    ).toThrow("version is not supported");
  });

  it("rejects mismatched or malformed persistent payloads", () => {
    expect(() =>
      encodeRamFile(persistentPayload([1], 5), identity),
    ).toThrow("does not match");

    const malformed = persistentPayload([1]);
    new DataView(malformed.buffer).setUint32(12, 2, true);
    expect(() => encodeRamFile(malformed, identity)).toThrow("invalid length");
  });
});
