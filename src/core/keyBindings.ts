import type { ModelButton } from "./types";

export const RESERVED_KEY_CODES = new Set([
  "F5",
  "F8",
  "F9",
  "F10",
  "F11",
]);

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "ContextMenu",
]);

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Backquote: "`",
  Backslash: "\\",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Equal: "=",
  Escape: "Esc",
  Home: "Home",
  Insert: "Insert",
  Minus: "-",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "Tab",
};

/** A per-button override. null means the user explicitly unbound the button. */
export type KeyBindingOverrides = Record<string, string | null>;

export interface BindingConflict {
  code: string;
  button: ModelButton;
}

export interface CoreBinding {
  button: ModelButton;
  code: string | null;
}

export function keyBindingLabel(code: string | null | undefined): string {
  if (!code) return "Not bound";
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  if (code === "NumpadEnter") return "Num Enter";
  if (code === "NumpadAdd") return "Num +";
  if (code === "NumpadSubtract") return "Num -";
  if (code === "NumpadMultiply") return "Num *";
  if (code === "NumpadDivide") return "Num /";
  if (code === "NumpadDecimal") return "Num .";
  return code;
}

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code) || code === "OSLeft" || code === "OSRight";
}

export function isReservedKeyCode(code: string): boolean {
  return RESERVED_KEY_CODES.has(code);
}

/** Normalize a KeyboardEvent.code into the form understood by the core. */
export function normalizeCapturedKey(code: string): string | null {
  if (!code || code === "Unidentified" || isModifierCode(code)) return null;
  return code;
}

export function buttonBinding(
  button: ModelButton,
  overrides: KeyBindingOverrides,
): string | null {
  return Object.prototype.hasOwnProperty.call(overrides, button.id)
    ? overrides[button.id]
    : button.keyname || null;
}

export function bindingOwner(
  code: string,
  buttons: ModelButton[],
  overrides: KeyBindingOverrides,
  exceptId?: string,
): BindingConflict | null {
  for (const button of buttons) {
    if (button.id !== exceptId && buttonBinding(button, overrides) === code) {
      return { code, button };
    }
  }
  return null;
}

export function assignBinding(
  overrides: KeyBindingOverrides,
  button: ModelButton,
  buttons: ModelButton[],
  code: string,
): KeyBindingOverrides {
  const next = { ...overrides };
  const owner = bindingOwner(code, buttons, next, button.id);
  if (owner) {
    if (owner.button.keyname) delete next[owner.button.id];
    else next[owner.button.id] = null;
  }
  next[button.id] = code;
  return next;
}

/**
 * Reset one button to its imported config binding, removing the override unless
 * the config default itself needs to be restored after a key move.
 */
export function resetBinding(
  overrides: KeyBindingOverrides,
  button: ModelButton,
): KeyBindingOverrides {
  const next = { ...overrides };
  if (!button.keyname) next[button.id] = null;
  else delete next[button.id];
  return next;
}

export function bindingsForCore(
  buttons: ModelButton[],
  overrides: KeyBindingOverrides,
): CoreBinding[] {
  const claimed = new Set<string>();
  return buttons.map((button) => {
    const code = buttonBinding(button, overrides);
    // The core stores one owner per key. Preserve the first button in model
    // order when an imported config itself contains a duplicate.
    if (code && claimed.has(code)) return { button, code: null };
    if (code) claimed.add(code);
    return { button, code };
  });
}
