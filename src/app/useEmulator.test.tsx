import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllData } from "../core/storage";
import type { ModelButton, ModelRecord } from "../core/types";

const core = vi.hoisted(() => ({
  releaseAll: vi.fn(),
  setKey: vi.fn(),
  handleKey: vi.fn(() => true),
  start: vi.fn().mockResolvedValue(undefined),
  loadModel: vi.fn().mockResolvedValue(undefined),
  readModelInfo: vi.fn(),
  bindKey: vi.fn(),
  unbindKey: vi.fn(),
  readFrame: vi.fn(() => null),
  readDebugState: vi.fn().mockResolvedValue(null),
  dispose: vi.fn(),
  savePersistentState: vi.fn(),
  loadPersistentState: vi.fn(),
  saveSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
  pause: vi.fn(),
  reset: vi.fn(),
  stepInto: vi.fn(),
  stepOver: vi.fn(),
  stepOut: vi.fn(),
  continue: vi.fn(),
  runTo: vi.fn(),
  readMemory: vi.fn(),
  writeMemory: vi.fn(),
  addBreakpoint: vi.fn(),
  removeBreakpoint: vi.fn(),
  coreReady: true,
}));

vi.mock("../core/wasm", () => ({ core }));

import { useEmulator } from "./useEmulator";

const buttons: ModelButton[] = [
  { id: "one", kiko: 0x11, keyname: "Digit1", rect: { x: 0, y: 0, w: 1, h: 1 } },
  { id: "shift", kiko: 0x12, keyname: "Shift+Digit9", rect: { x: 0, y: 0, w: 1, h: 1 } },
];

const record = {
  id: "model-a",
  name: "Model A",
  hardwareName: "ClassWiz",
  hardwareId: 4,
  manifest: {
    modelName: "Model A",
    hardwareId: 4,
    realHardware: true,
    inkColor: { r: 0, g: 0, b: 0 },
    buttons,
    statusIndicators: [],
    statusSpriteIndexes: {},
    sprites: {},
  },
  files: [],
  bytes: 0,
  romHash: "",
  source: "json",
  importedAt: 0,
  updatedAt: 0,
} as unknown as ModelRecord;

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllData();
  core.readModelInfo.mockReturnValue({ buttons });
  core.readFrame.mockReturnValue(null);
  core.readDebugState.mockResolvedValue(null);
  core.handleKey.mockReturnValue(true);
});

describe("useEmulator macros", () => {
  it("records button input and saves it under the active model", async () => {
    const { result } = renderHook(() => useEmulator(record));
    await waitFor(() => expect(result.current.status).toBe("paused"));

    act(() => result.current.startMacroRecording());
    act(() => result.current.press(0x11, true));
    act(() => result.current.press(0x11, false));
    act(() => result.current.stopMacroRecording());

    expect(result.current.pendingRecording?.events).toHaveLength(2);
    await act(async () => result.current.saveMacroRecording("One"));

    expect(result.current.macros).toHaveLength(1);
    expect(result.current.macros[0]).toMatchObject({
      name: "One",
      events: [
        { kiko: 0x11, label: "Digit1", pressed: true },
        { kiko: 0x11, label: "Digit1", pressed: false },
      ],
    });
  });

  it("records mapped keyboard input using the calculator keycode", async () => {
    const { result } = renderHook(() => useEmulator(record));
    await waitFor(() => expect(result.current.status).toBe("paused"));

    act(() => result.current.startMacroRecording());
    act(() => result.current.handleKey("Shift+Digit9", true));
    act(() => result.current.handleKey("Shift+Digit9", false));
    act(() => result.current.stopMacroRecording());

    expect(result.current.pendingRecording?.events).toMatchObject([
      { kiko: 0x12, pressed: true },
      { kiko: 0x12, pressed: false },
    ]);
    expect(core.handleKey).toHaveBeenCalledWith("Shift+Digit9", true);
  });

  it("records releases when all keys are released during a recording", async () => {
    const { result } = renderHook(() => useEmulator(record));
    await waitFor(() => expect(result.current.status).toBe("paused"));

    act(() => result.current.startMacroRecording());
    act(() => result.current.press(0x11, true));
    act(() => result.current.releaseAll());
    act(() => result.current.stopMacroRecording());

    expect(result.current.pendingRecording?.events).toMatchObject([
      { kiko: 0x11, pressed: true },
      { kiko: 0x11, pressed: false },
    ]);
  });

  it("ignores on-screen input while a macro is replaying", async () => {
    const { result } = renderHook(() => useEmulator(record));
    await waitFor(() => expect(result.current.status).toBe("paused"));
    const macro = {
      id: "macro",
      name: "Delayed",
      createdAt: 1,
      durationMs: 10_000,
      events: [{ kiko: 1, label: "1", pressed: true, atMs: 10_000 }],
    };
    macro.events.push({ kiko: 1, label: "1", pressed: false, atMs: 10_000 });

    act(() => result.current.replayMacro(macro));
    act(() => result.current.press(0x11, true));

    expect(core.setKey).not.toHaveBeenCalledWith(0x11, true);
    act(() => result.current.stopMacroReplay());
  });

  it("replays saved events through setKey and releases all keys on stop", async () => {
    const { result } = renderHook(() => useEmulator(record));
    await waitFor(() => expect(result.current.status).toBe("paused"));
    const macro = {
      id: "macro",
      name: "Quick",
      createdAt: 1,
      durationMs: 30,
      events: [
        { kiko: 1, label: "1", pressed: true, atMs: 0 },
        { kiko: 1, label: "1", pressed: false, atMs: 30 },
      ],
    };

    act(() => result.current.replayMacro(macro));
    await waitFor(() => expect(core.setKey).toHaveBeenCalledWith(1, true));
    expect(core.start).toHaveBeenCalled();
    act(() => result.current.stopMacroReplay());

    expect(core.releaseAll).toHaveBeenCalled();
    expect(result.current.replayingMacroId).toBeNull();
  });

  it("cancels recording when the active model changes", async () => {
    const { result, rerender } = renderHook(
      ({ activeRecord }) => useEmulator(activeRecord),
      { initialProps: { activeRecord: record } },
    );
    await waitFor(() => expect(result.current.status).toBe("paused"));

    act(() => result.current.startMacroRecording());
    act(() => result.current.press(0x11, true));
    rerender({ activeRecord: { ...record, id: "model-b" } });

    await waitFor(() => expect(result.current.status).toBe("paused"));
    expect(result.current.recording).toBe(false);
    expect(result.current.pendingRecording).toBeNull();
    expect(result.current.replayingMacroId).toBeNull();
    expect(core.releaseAll).toHaveBeenCalled();
  });

  it("cancels an active replay when the active model changes", async () => {
    const { result, rerender } = renderHook(
      ({ activeRecord }) => useEmulator(activeRecord),
      { initialProps: { activeRecord: record } },
    );
    await waitFor(() => expect(result.current.status).toBe("paused"));
    const macro = {
      id: "macro",
      name: "Delayed",
      createdAt: 1,
      durationMs: 10_000,
      events: [
        { kiko: 1, label: "1", pressed: true, atMs: 10_000 },
        { kiko: 1, label: "1", pressed: false, atMs: 10_000 },
      ],
    };

    act(() => result.current.replayMacro(macro));
    expect(result.current.replayingMacroId).toBe("macro");
    rerender({ activeRecord: { ...record, id: "model-b" } });

    expect(result.current.replayingMacroId).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("paused"));
  });

  it("releases all keys when the window loses focus", async () => {
    const { result } = renderHook(() => useEmulator(record));
    await waitFor(() => expect(result.current.status).toBe("paused"));
    act(() => result.current.startMacroRecording());
    act(() => result.current.press(0x11, true));
    core.releaseAll.mockClear();

    act(() => window.dispatchEvent(new Event("blur")));

    expect(result.current.recording).toBe(false);
    expect(result.current.pendingRecording).toBeNull();
    expect(core.releaseAll).toHaveBeenCalled();
  });

  it("discards empty recordings", () => {
    const { result } = renderHook(() => useEmulator(record));
    act(() => result.current.press(0x11, true));
    core.releaseAll.mockClear();
    act(() => result.current.startMacroRecording());
    expect(core.releaseAll).toHaveBeenCalled();
    act(() => result.current.stopMacroRecording());
    expect(core.releaseAll).toHaveBeenCalled();
    expect(result.current.pendingRecording).toBeNull();
    expect(result.current.recording).toBe(false);
  });
});
