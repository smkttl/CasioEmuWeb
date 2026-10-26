import { describe, expect, it } from "vitest";
import {
  assignBinding,
  bindingOwner,
  bindingsForCore,
  buttonBinding,
  isReservedKeyCode,
  keyBindingLabel,
  normalizeCapturedKey,
  resetBinding,
} from "./keyBindings";
import type { ModelButton } from "./types";

function button(id: string, kiko: number, keyname = ""): ModelButton {
  return {
    id,
    kiko,
    keyname,
    rect: { x: 0, y: 0, w: 10, h: 10 },
  };
}

describe("key bindings", () => {
  const one = button("one", 0x11, "Digit1");
  const two = button("two", 0x12, "Digit2");
  const unbound = button("unbound", 0x13);

  it("uses config defaults until an override exists", () => {
    expect(buttonBinding(one, {})).toBe("Digit1");
    expect(buttonBinding(unbound, {})).toBeNull();
    expect(buttonBinding(one, { one: "KeyQ" })).toBe("KeyQ");
    expect(buttonBinding(unbound, { unbound: null })).toBeNull();
  });

  it("finds the button that owns a key, optionally excluding the target", () => {
    expect(bindingOwner("Digit2", [one, two], {})?.button.id).toBe("two");
    expect(bindingOwner("Digit2", [one, two], {}, "two")).toBeNull();
    expect(bindingOwner("KeyZ", [one, two], {})).toBeNull();
  });

  it("moves a conflicting key and restores the displaced config default", () => {
    const next = assignBinding({ one: "KeyQ", two: "KeyW" }, one, [one, two], "KeyW");
    expect(next).toEqual({ one: "KeyW" });
    expect(buttonBinding(two, next)).toBe("Digit2");
    expect(buttonBinding(one, next)).toBe("KeyW");
  });

  it("leaves an unbound displaced button unbound", () => {
    const moved = assignBinding({ unbound: "KeyQ" }, one, [one, unbound], "KeyQ");
    expect(buttonBinding(unbound, moved)).toBeNull();
    expect(buttonBinding(one, moved)).toBe("KeyQ");
  });

  it("resets a button to its config default or to unbound", () => {
    expect(resetBinding({ one: "KeyQ" }, one)).toEqual({});
    expect(resetBinding({ unbound: "KeyQ" }, unbound)).toEqual({ unbound: null });
  });

  it("builds the core binding list with overridden and cleared values", () => {
    expect(bindingsForCore([one, two], { one: "KeyQ", two: null })).toEqual([
      { button: one, code: "KeyQ" },
      { button: two, code: null },
    ]);
  });

  it("keeps one owner when the imported config contains a duplicate", () => {
    const duplicate = button("duplicate", 0x14, "Digit1");
    expect(bindingsForCore([one, duplicate], {})).toEqual([
      { button: one, code: "Digit1" },
      { button: duplicate, code: null },
    ]);
  });

  it("formats keyboard codes for the UI", () => {
    expect(keyBindingLabel("KeyQ")).toBe("Q");
    expect(keyBindingLabel("Digit7")).toBe("7");
    expect(keyBindingLabel("NumpadEnter")).toBe("Num Enter");
    expect(keyBindingLabel("ArrowLeft")).toBe("Left");
    expect(keyBindingLabel(null)).toBe("Not bound");
  });

  it("rejects modifier-only keys and detects debugger shortcuts", () => {
    expect(normalizeCapturedKey("ShiftLeft")).toBeNull();
    expect(normalizeCapturedKey("ControlRight")).toBeNull();
    expect(normalizeCapturedKey("KeyQ")).toBe("KeyQ");
    expect(isReservedKeyCode("F5")).toBe(true);
    expect(isReservedKeyCode("F12")).toBe(false);
  });
});
