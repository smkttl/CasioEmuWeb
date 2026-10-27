import { describe, expect, it } from "vitest";
import { keyCodeFor, parseRegisters } from "./wasm";

describe("register parsing", () => {
  it("reconstructs 16-bit register pairs from byte registers", () => {
    const json = JSON.stringify({
      r0: 0x34,
      r1: 0x12,
      r2: 0xcd,
      r3: 0xab,
      pc: 0x1234,
      sp: 0x2345,
      psw: 0x56,
      dsr: 0x78,
    });
    const registers = parseRegisters(json);
    expect(registers.er[0]).toBe(0x1234);
    expect(registers.er[1]).toBe(0xabcd);
    expect(registers.r).toHaveLength(16);
    expect(registers.pc).toBe(0x1234);
    expect(registers.flags).toEqual(["PSW 56", "DSR 78"]);
  });

  it("uses zeroes for missing registers and flags", () => {
    const registers = parseRegisters("{}");
    expect(registers.r).toEqual(Array(16).fill(0));
    expect(registers.er).toEqual(Array(8).fill(0));
    expect(registers.flags).toEqual([]);
  });
});

describe("physical key mapping", () => {
  it.each([
    ["ArrowUp", 38],
    ["F5", 116],
    ["KeyA", 65],
    ["Digit7", 55],
    ["Numpad9", 105],
    ["+", 187],
    ["-", 189],
    ["*", 106],
    ["/", 111],
    [".", 190],
    ["7", 55],
    ["x", null],
    ["fn_05", null],
    ["AC/ON", null],
  ])("maps %s to %s", (name, expected) => {
    expect(keyCodeFor(name)).toBe(expected);
  });

  it("supports Keypad-prefixed manifest names", () => {
    expect(keyCodeFor("Keypad Enter")).toBe(13);
    expect(keyCodeFor("Keypad 5")).toBeNull();
  });

  it("maps modifier chords into a stable synthetic keycode range", () => {
    const plain = keyCodeFor("Digit9");
    const shifted = keyCodeFor("Shift+Digit9");
    expect(plain).toBe(57);
    expect(shifted).toBe(0x10000000 + (0x4 << 16) + 57);
    expect(shifted).not.toBe(plain);
    expect(keyCodeFor("Shift+Digit9")).toBe(shifted);
    expect(keyCodeFor("Control+Alt+Shift+Meta+KeyQ")).toBe(
      0x10000000 + (0xf << 16) + 81,
    );
    expect(keyCodeFor("Shift+UnknownKey")).toBeNull();
  });
});
