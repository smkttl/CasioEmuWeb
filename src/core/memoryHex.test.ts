import { describe, expect, it } from "vitest";
import {
  MAX_BULK_MEMORY_BYTES,
  MemoryHexError,
  parseMemoryHex,
} from "./memoryHex";

describe("bulk memory hex parsing", () => {
  it("parses uppercase and lowercase bytes separated by mixed whitespace", () => {
    expect([...parseMemoryHex("00 ff\t1A\n0B\r\n 7f")]).toEqual([
      0x00, 0xff, 0x1a, 0x0b, 0x7f,
    ]);
  });

  it("parses a single byte and the maximum payload", () => {
    expect([...parseMemoryHex("A5")]).toEqual([0xa5]);
    const maximum = Array.from(
      { length: MAX_BULK_MEMORY_BYTES },
      () => "00",
    ).join(" ");
    expect(parseMemoryHex(maximum)).toHaveLength(MAX_BULK_MEMORY_BYTES);
  });

  it("rejects empty input", () => {
    expect(() => parseMemoryHex(" \n\t ")).toThrow(MemoryHexError);
    expect(() => parseMemoryHex("")).toThrow("at least one");
  });

  it("identifies malformed tokens by line and column", () => {
    expect(() => parseMemoryHex("00 01\n  0x02")).toThrow(
      'Invalid hex byte "0x02" on line 2, column 3',
    );
    expect(() => parseMemoryHex("00, 01")).toThrow('"00,"');
    expect(() => parseMemoryHex("0 G1")).toThrow('"0"');
    expect(() => parseMemoryHex("00 G1")).toThrow('"G1"');
    expect(() => parseMemoryHex("ABC")).toThrow('"ABC"');
  });

  it("rejects payloads over the size limit", () => {
    const oversized = `${"00 ".repeat(MAX_BULK_MEMORY_BYTES)}00`;
    expect(() => parseMemoryHex(oversized)).toThrow("exceeds");
  });
});
