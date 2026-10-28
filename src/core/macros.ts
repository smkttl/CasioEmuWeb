export type MacroReplaySpeed = 0.5 | 1 | 2 | "instant";

export interface MacroKeyEvent {
  kiko: number;
  label: string;
  pressed: boolean;
  atMs: number;
}

export interface KeyMacro {
  id: string;
  name: string;
  createdAt: number;
  durationMs: number;
  events: MacroKeyEvent[];
}

export interface MacroRecording {
  startedAt: number;
  events: MacroKeyEvent[];
}

export interface MacroPlayback {
  macro: KeyMacro;
  speed: MacroReplaySpeed;
  startedAt: number;
  elapsedMs: number;
  events: MacroKeyEvent[];
}

export interface MacroStore {
  macros: KeyMacro[];
  replaySpeed: MacroReplaySpeed;
}

const MAX_MACROS = 100;
const MAX_EVENTS_PER_MACRO = 5_000;
const MAX_MACRO_DURATION_MS = 24 * 60 * 60 * 1000;
const SPEEDS: MacroReplaySpeed[] = [0.5, 1, 2, "instant"];

function isSpeed(value: unknown): value is MacroReplaySpeed {
  return value === 0.5 || value === 1 || value === 2 || value === "instant";
}

function normalizeEvent(value: unknown): MacroKeyEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<MacroKeyEvent>;
  if (
    !Number.isInteger(event.kiko) ||
    event.kiko! < 0 ||
    event.kiko! > 255 ||
    typeof event.label !== "string" ||
    !event.label.trim() ||
    typeof event.pressed !== "boolean" ||
    typeof event.atMs !== "number" ||
    !Number.isFinite(event.atMs) ||
    event.atMs < 0 ||
    event.atMs > MAX_MACRO_DURATION_MS
  ) {
    return null;
  }
  return {
    kiko: event.kiko!,
    label: event.label.trim().slice(0, 80),
    pressed: event.pressed,
    atMs: event.atMs,
  };
}

function normalizeMacro(value: unknown): KeyMacro | null {
  if (!value || typeof value !== "object") return null;
  const macro = value as Partial<KeyMacro>;
  if (
    typeof macro.id !== "string" ||
    !macro.id ||
    typeof macro.name !== "string" ||
    !macro.name.trim() ||
    typeof macro.createdAt !== "number" ||
    !Number.isFinite(macro.createdAt) ||
    typeof macro.durationMs !== "number" ||
    !Number.isFinite(macro.durationMs) ||
    macro.durationMs < 0 ||
    macro.durationMs > MAX_MACRO_DURATION_MS ||
    !Array.isArray(macro.events) ||
    macro.events.length === 0 ||
    macro.events.length > MAX_EVENTS_PER_MACRO
  ) {
    return null;
  }
  const events = macro.events.map(normalizeEvent);
  if (events.some((event) => !event)) return null;
  const validEvents = events as MacroKeyEvent[];
  for (let index = 1; index < validEvents.length; index += 1) {
    if (validEvents[index].atMs < validEvents[index - 1].atMs) return null;
  }
  if (validEvents.some((event) => event.atMs > macro.durationMs!)) return null;
  const held = new Set<number>();
  for (const event of validEvents) {
    if (event.pressed) held.add(event.kiko);
    else held.delete(event.kiko);
  }
  if (held.size) return null;
  return {
    id: macro.id,
    name: macro.name.trim().slice(0, 80),
    createdAt: macro.createdAt,
    durationMs: macro.durationMs,
    events: validEvents,
  };
}

export function normalizeMacroStore(value: unknown): MacroStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { macros: [], replaySpeed: 1 };
  }
  const store = value as Partial<MacroStore>;
  const macros = Array.isArray(store.macros)
    ? store.macros
        .map(normalizeMacro)
        .filter((macro): macro is KeyMacro => Boolean(macro))
        .slice(0, MAX_MACROS)
    : [];
  return {
    macros,
    replaySpeed: isSpeed(store.replaySpeed) ? store.replaySpeed : 1,
  };
}

export function upsertMacro(store: MacroStore, macro: KeyMacro): MacroStore {
  const normalized = normalizeMacro(macro);
  if (!normalized) throw new Error("The macro contains invalid key events.");
  const macros = store.macros.filter((item) => item.id !== normalized.id);
  return {
    ...store,
    macros: [...macros, normalized].slice(-MAX_MACROS),
  };
}

export function deleteMacro(store: MacroStore, id: string): MacroStore {
  return { ...store, macros: store.macros.filter((macro) => macro.id !== id) };
}

export function createMacro(
  name: string,
  recording: MacroRecording,
  createdAt = Date.now(),
): KeyMacro {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a macro name.");
  if (!recording.events.length) throw new Error("The recording contains no key presses.");
  const events = recording.events.map(normalizeEvent);
  if (events.some((event) => !event)) throw new Error("The recording is invalid.");
  const durationMs = Math.max(
    0,
    ...(events as MacroKeyEvent[]).map((event) => event.atMs),
  );
  return {
    id: `macro-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed.slice(0, 80),
    createdAt,
    durationMs,
    events: events as MacroKeyEvent[],
  };
}

export function formatMacroSize(macro: KeyMacro) {
  const keys = new Set(macro.events.map((event) => event.kiko)).size;
  const presses = macro.events.filter((event) => event.pressed).length;
  return `${presses} ${presses === 1 ? "press" : "presses"} · ${keys} ${
    keys === 1 ? "key" : "keys"
  } · ${(macro.durationMs / 1000).toFixed(1)}s`;
}

export function replayDelayMs(
  event: MacroKeyEvent,
  previousAtMs: number,
  speed: MacroReplaySpeed,
) {
  if (speed === "instant") return 0;
  return Math.max(0, (event.atMs - previousAtMs) / speed);
}

export function macroSpeedLabel(speed: MacroReplaySpeed) {
  return speed === "instant" ? "Instant" : `${speed}x`;
}

export const MACRO_REPLAY_SPEEDS = SPEEDS;
export const MAX_RECORDED_EVENTS = MAX_EVENTS_PER_MACRO;
export const MAX_RECORDING_DURATION_MS = MAX_MACRO_DURATION_MS;
