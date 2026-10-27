import type { ModelButton } from "./types";

export const RESERVED_KEY_CODES = new Set([
  "F5",
  "F8",
  "F9",
  "F10",
  "F11",
]);

const MODIFIER_PREFIXES = ["Control", "Alt", "Shift", "Meta"] as const;
type ModifierPrefix = (typeof MODIFIER_PREFIXES)[number];

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

export interface KeyModifierState {
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export interface ParsedKeyChord {
  modifiers: ModifierPrefix[];
  base: string;
}

export function parseKeyChord(code: string): ParsedKeyChord {
  let base = code.trim();
  const modifiers: ModifierPrefix[] = [];
  let matched = true;
  while (matched) {
    matched = false;
    for (const modifier of MODIFIER_PREFIXES) {
      const prefix = `${modifier}+`;
      if (base.startsWith(prefix)) {
        modifiers.push(modifier);
        base = base.slice(prefix.length);
        matched = true;
        break;
      }
    }
  }
  return { modifiers, base };
}

export function keyChordFromEvent(
  code: string,
  modifiers: KeyModifierState = {},
): string | null {
  const base = normalizeCapturedKey(code);
  if (!base) return null;
  const prefixes = [
    modifiers.ctrlKey ? "Control" : "",
    modifiers.altKey ? "Alt" : "",
    modifiers.shiftKey ? "Shift" : "",
    modifiers.metaKey ? "Meta" : "",
  ].filter(Boolean);
  return prefixes.length ? `${prefixes.join("+")}+${base}` : base;
}

export function keyBindingLabel(code: string | null | undefined): string {
  if (!code) return "Not bound";
  const { modifiers, base } = parseKeyChord(code);
  const label = keyBaseLabel(base);
  const prefix = modifiers.map((modifier) => (modifier === "Control" ? "Ctrl" : modifier));
  return prefix.length ? `${prefix.join("+")}+${label}` : label;
}

function keyBaseLabel(code: string): string {
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
  return RESERVED_KEY_CODES.has(parseKeyChord(code).base);
}

/** Normalize a KeyboardEvent.code into the form understood by the core. */
export function normalizeCapturedKey(code: string): string | null {
  if (!code || code === "Unidentified" || isModifierCode(code)) return null;
  return code;
}

export class KeyChordTracker {
  private active = new Map<string, string>();

  press(physicalCode: string, chord: string): boolean {
    if (this.active.has(physicalCode)) return false;
    this.active.set(physicalCode, chord);
    return true;
  }

  isActive(physicalCode: string): boolean {
    return this.active.has(physicalCode);
  }

  release(physicalCode: string): string | null {
    const chord = this.active.get(physicalCode) ?? null;
    this.active.delete(physicalCode);
    return chord;
  }

  clear(): string[] {
    const chords = [...this.active.values()];
    this.active.clear();
    return chords;
  }
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
