import { afterEach, describe, expect, it, vi } from "vitest";
import { MacroPlayback } from "./macroPlayback";
import { MacroRecorder } from "./macroRecorder";
import {
  createMacro,
  deleteMacro,
  formatMacroSize,
  normalizeMacroStore,
  replayDelayMs,
  upsertMacro,
  type KeyMacro,
  type MacroRecording,
} from "./macros";

const recording: MacroRecording = {
  startedAt: 0,
  events: [
    { kiko: 1, label: "1", pressed: true, atMs: 10 },
    { kiko: 1, label: "1", pressed: false, atMs: 40 },
    { kiko: 2, label: "Shift", pressed: true, atMs: 100 },
    { kiko: 2, label: "Shift", pressed: false, atMs: 130 },
  ],
};

function macro(overrides: Partial<KeyMacro> = {}): KeyMacro {
  return {
    id: "macro-a",
    name: "Example",
    createdAt: 100,
    durationMs: 130,
    events: recording.events,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("macro recording", () => {
  it("records ordered elapsed press and release events", () => {
    const recorder = new MacroRecorder();
    recorder.start(1000);
    recorder.record(1, "1", true, 1030);
    recorder.record(1, "1", false, 1080);
    recorder.record(2, "Shift", true, 1120);

    expect(recorder.stop()).toMatchObject({
      startedAt: 1000,
      events: [
        { kiko: 1, label: "1", pressed: true, atMs: 30 },
        { kiko: 1, label: "1", pressed: false, atMs: 80 },
        { kiko: 2, label: "Shift", pressed: true, atMs: 120 },
      ],
    });
    expect(recorder.active).toBe(false);
  });

  it("stops capturing after cancellation", () => {
    const recorder = new MacroRecorder();
    recorder.start(0);
    recorder.record(1, "1", true, 10);
    recorder.cancel();
    expect(recorder.record(1, "1", false, 20)).toBeNull();
    expect(recorder.stop()).toBeNull();
  });

  it("rejects empty recordings and creates bounded macro metadata", () => {
    expect(() =>
      createMacro("Empty", { startedAt: 0, events: [] }, 100),
    ).toThrow("no key presses");
    const created = createMacro("  My sequence  ", recording, 100);
    expect(created).toMatchObject({
      name: "My sequence",
      createdAt: 100,
      durationMs: 130,
    });
    expect(created.id).toMatch(/^macro-100-/);
  });
});

describe("macro persistence and replay", () => {
  it("normalizes malformed stored data and rejects held-key corruption", () => {
    expect(normalizeMacroStore(null)).toEqual({ macros: [], replaySpeed: 1 });
    expect(
      normalizeMacroStore({
        replaySpeed: 2,
        macros: [
          macro(),
          macro({
            id: "macro-held",
            events: [{ kiko: 1, label: "1", pressed: true, atMs: 10 }],
            durationMs: 10,
          }),
        ],
      }),
    ).toEqual({ macros: [macro()], replaySpeed: 2 });
  });

  it("upserts, deletes, and summarizes macros", () => {
    const initial = { macros: [], replaySpeed: 1 as const };
    const saved = upsertMacro(initial, macro());
    expect(saved.macros).toHaveLength(1);
    expect(formatMacroSize(saved.macros[0])).toBe("2 presses · 2 keys · 0.1s");
    expect(deleteMacro(saved, "macro-a").macros).toEqual([]);
  });

  it("scales event delays and handles instant replay", () => {
    expect(replayDelayMs(recording.events[1], 10, 0.5)).toBe(60);
    expect(replayDelayMs(recording.events[1], 10, 1)).toBe(30);
    expect(replayDelayMs(recording.events[1], 10, 2)).toBe(15);
    expect(replayDelayMs(recording.events[1], 10, "instant")).toBe(0);
  });

  it("replays key events and releases all keys on completion", () => {
    vi.useFakeTimers();
    const press = vi.fn();
    const releaseAll = vi.fn();
    const onComplete = vi.fn();
    const playback = new MacroPlayback({
      macro: macro(),
      speed: 1,
      press,
      releaseAll,
      onProgress: vi.fn(),
      onComplete,
      onError: vi.fn(),
    });
    playback.start();
    vi.advanceTimersByTime(130);

    expect(press.mock.calls).toEqual([
      [1, true],
      [1, false],
      [2, true],
      [2, false],
    ]);
    expect(releaseAll).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("cancels remaining events and releases held keys", () => {
    vi.useFakeTimers();
    const press = vi.fn();
    const releaseAll = vi.fn();
    const playback = new MacroPlayback({
      macro: macro(),
      speed: 1,
      press,
      releaseAll,
      onProgress: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    });
    playback.start();
    vi.advanceTimersByTime(10);
    press.mockClear();
    playback.cancel();
    vi.advanceTimersByTime(1_000);

    expect(press).not.toHaveBeenCalled();
    expect(releaseAll).toHaveBeenCalled();
  });
});
