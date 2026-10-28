import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RamImportPreview } from "../core/ramFile";
import type { DebugSnapshot } from "../core/types";
import type { KeyMacro, MacroRecording } from "../core/macros";
import { DebuggerContent } from "./Debugger";
import type { EmulatorSession } from "./useEmulator";

afterEach(cleanup);

const debug: DebugSnapshot = {
  registers: {
    r: Array(16).fill(0),
    er: Array(8).fill(0),
    pc: 0,
    sp: 0,
    ea: 0,
    lr: 0,
    psw: 0,
    dsr: 0,
    csr: 0,
    flags: [],
  },
  disassembly: [],
  breakpoints: [],
  callStack: [],
  memoryBase: 0,
  memory: new Uint8Array(),
  paused: true,
  stopReason: "none",
};

function session(overrides: Partial<EmulatorSession> = {}): EmulatorSession {
  return {
    sessionKey: 0,
    status: "paused",
    message: "Ready",
    frame: null,
    debug,
    snapshots: [],
    modelInfo: null,
    coreReady: true,
    start: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    stepInto: vi.fn(),
    stepOver: vi.fn(),
    stepOut: vi.fn(),
    continueRun: vi.fn(),
    runTo: vi.fn(),
    press: vi.fn(),
    handleKey: vi.fn(),
    releaseAll: vi.fn(),
    buttons: [],
    keyBindings: {},
    setKeyBinding: vi.fn(),
    resetKeyBinding: vi.fn(),
    readMemory: vi.fn().mockResolvedValue(new Uint8Array()),
    writeMemory: vi.fn(),
    addBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    saveSnapshot: vi.fn(),
    restoreSnapshot: vi.fn(),
    removeSnapshot: vi.fn(),
    downloadRam: vi.fn().mockResolvedValue(undefined),
    readRamFile: vi.fn(),
    restoreRam: vi.fn().mockResolvedValue(undefined),
    macros: [],
    replaySpeed: 1,
    recording: false,
    recordedEvents: 0,
    recordingElapsedMs: 0,
    pendingRecording: null,
    replayingMacroId: null,
    replayElapsedMs: 0,
    startMacroRecording: vi.fn(),
    stopMacroRecording: vi.fn(),
    discardMacroRecording: vi.fn(),
    saveMacroRecording: vi.fn(),
    deleteMacro: vi.fn(),
    setReplaySpeed: vi.fn(),
    replayMacro: vi.fn(),
    stopMacroReplay: vi.fn(),
    persistNow: vi.fn(),
    ...overrides,
  };
}

const preview: RamImportPreview = {
  fileName: "session.cewram",
  metadata: {
    format: "CasioEmuWeb.Ram",
    version: 1,
    modelId: "model",
    modelName: "Test Model",
    hardwareId: 4,
    exportedAt: "2026-10-28T14:30:00.000Z",
  },
  payload: new Uint8Array([1, 2, 3]),
};

const macro: KeyMacro = {
  id: "macro-a",
  name: "My macro",
  createdAt: 1,
  durationMs: 100,
  events: [
    { kiko: 1, label: "1", pressed: true, atMs: 0 },
    { kiko: 1, label: "1", pressed: false, atMs: 100 },
  ],
};

const pendingRecording: MacroRecording = {
  startedAt: 0,
  events: [
    { kiko: 1, label: "1", pressed: true, atMs: 0 },
    { kiko: 1, label: "1", pressed: false, atMs: 50 },
  ],
};

describe("RAM file controls", () => {
  it("downloads RAM and shows success", async () => {
    const downloadRam = vi.fn().mockResolvedValue(undefined);
    render(<DebuggerContent tab="snapshots" session={session({ downloadRam })} />);

    fireEvent.click(screen.getByRole("button", { name: "Save RAM" }));

    expect(downloadRam).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("RAM file downloaded");
  });

  it("shows download errors", async () => {
    const downloadRam = vi.fn().mockRejectedValue(new Error("No persistent state"));
    render(<DebuggerContent tab="snapshots" session={session({ downloadRam })} />);

    fireEvent.click(screen.getByRole("button", { name: "Save RAM" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No persistent state");
  });

  it("confirms a validated RAM file before replacing it", async () => {
    const readRamFile = vi.fn().mockResolvedValue(preview);
    const restoreRam = vi.fn().mockResolvedValue(undefined);
    render(
      <DebuggerContent tab="snapshots" session={session({ readRamFile, restoreRam })} />,
    );

    fireEvent.change(screen.getByLabelText("Load RAM file"), {
      target: { files: [new File(["ram"], "session.cewram")] },
    });

    expect(
      await screen.findByRole("alertdialog", { name: "Confirm RAM replacement" }),
    ).toHaveTextContent("session.cewram");
    expect(restoreRam).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Replace RAM" }));
    await waitFor(() => expect(restoreRam).toHaveBeenCalledWith(preview));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loaded RAM");
  });

  it("leaves the session unchanged when replacement is cancelled", async () => {
    const restoreRam = vi.fn();
    render(
      <DebuggerContent
        tab="snapshots"
        session={session({
          readRamFile: vi.fn().mockResolvedValue(preview),
          restoreRam,
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Load RAM file"), {
      target: { files: [new File(["ram"], "session.cewram")] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(restoreRam).not.toHaveBeenCalled();
  });

  it("shows file validation errors", async () => {
    render(
      <DebuggerContent
        tab="snapshots"
        session={session({
          readRamFile: vi.fn().mockRejectedValue(new Error("different calculator hardware")),
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Load RAM file"), {
      target: { files: [new File(["ram"], "wrong.cewram")] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "different calculator hardware",
    );
  });
});

describe("bulk memory editing", () => {
  it("previews exact bytes and applies them once at the captured address", async () => {
    const readMemory = vi.fn().mockResolvedValue(new Uint8Array(16));
    const writeMemory = vi.fn().mockResolvedValue(undefined);
    render(
      <DebuggerContent
        tab="memory"
        session={session({ readMemory, writeMemory })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Hex bytes"), {
      target: { value: "00 ff\n1A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      screen.getByRole("region", { name: "Bulk write preview" }),
    ).toHaveTextContent("0000–0002");
    expect(writeMemory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply write" }));
    await waitFor(() =>
      expect(writeMemory).toHaveBeenCalledWith(
        0,
        new Uint8Array([0x00, 0xff, 0x1a]),
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Wrote 3 bytes");
    expect(screen.queryByRole("region", { name: "Bulk write preview" })).toBeNull();
  });

  it("requires a fresh preview after the draft changes", () => {
    render(<DebuggerContent tab="memory" session={session()} />);

    const input = screen.getByLabelText("Hex bytes");
    fireEvent.change(input, { target: { value: "01 02" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.change(input, { target: { value: "03 04" } });

    expect(screen.queryByRole("region", { name: "Bulk write preview" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply write" })).toBeDisabled();
  });

  it("requires a fresh preview after the address changes", () => {
    render(<DebuggerContent tab="memory" session={session()} />);

    fireEvent.change(screen.getByLabelText("Hex bytes"), {
      target: { value: "01 02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "0100" },
    });

    expect(screen.queryByRole("region", { name: "Bulk write preview" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply write" })).toBeDisabled();
  });

  it("shows parser errors without writing", () => {
    const writeMemory = vi.fn();
    render(
      <DebuggerContent
        tab="memory"
        session={session({ writeMemory })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Hex bytes"), {
      target: { value: "00 0x01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      'Invalid hex byte "0x01" on line 1',
    );
    expect(writeMemory).not.toHaveBeenCalled();
  });

  it("keeps a failed write armed for retry", async () => {
    const writeMemory = vi
      .fn()
      .mockRejectedValueOnce(new Error("Pause the emulator first."))
      .mockResolvedValueOnce(undefined);
    render(
      <DebuggerContent
        tab="memory"
        session={session({ writeMemory })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Hex bytes"), {
      target: { value: "AA BB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply write" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pause the emulator first.",
    );
    expect(screen.getByRole("button", { name: "Apply write" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Apply write" }));
    await waitFor(() => expect(writeMemory).toHaveBeenCalledTimes(2));
  });

  it("disables bulk editing while the calculator is running", () => {
    render(
      <DebuggerContent
        tab="memory"
        session={session({ status: "running" })}
      />,
    );

    expect(screen.getByLabelText("Hex bytes")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });
});

describe("macro controls", () => {
  it("starts recording and shows live event status", () => {
    const startMacroRecording = vi.fn();
    const { rerender } = render(
      <DebuggerContent
        tab="macros"
        session={session({ startMacroRecording })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(startMacroRecording).toHaveBeenCalledOnce();

    rerender(
      <DebuggerContent
        tab="macros"
        session={session({
          recording: true,
          recordedEvents: 3,
          recordingElapsedMs: 1200,
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("3 events");
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
  });

  it("reviews and saves a recording", async () => {
    const saveMacroRecording = vi.fn().mockResolvedValue(macro);
    render(
      <DebuggerContent
        tab="macros"
        session={session({ pendingRecording, saveMacroRecording })}
      />,
    );

    expect(screen.getByRole("region", { name: "Review recording" })).toHaveTextContent(
      "1 key presses",
    );
    fireEvent.change(screen.getByLabelText("Macro name"), {
      target: { value: "My macro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save macro" }));
    await waitFor(() =>
      expect(saveMacroRecording).toHaveBeenCalledWith("My macro"),
    );
  });

  it("discards a recording", () => {
    const discardMacroRecording = vi.fn();
    render(
      <DebuggerContent
        tab="macros"
        session={session({ pendingRecording, discardMacroRecording })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discardMacroRecording).toHaveBeenCalledOnce();
  });

  it("changes replay speed and replays a saved macro", () => {
    const setReplaySpeed = vi.fn().mockResolvedValue(undefined);
    const replayMacro = vi.fn();
    render(
      <DebuggerContent
        tab="macros"
        session={session({ macros: [macro], setReplaySpeed, replayMacro })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Replay speed"), {
      target: { value: "2" },
    });
    expect(setReplaySpeed).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(replayMacro).toHaveBeenCalledWith(macro);
  });

  it("shows playback progress and stops an active replay", () => {
    const stopMacroReplay = vi.fn();
    render(
      <DebuggerContent
        tab="macros"
        session={session({
          macros: [macro],
          replayingMacroId: macro.id,
          replayElapsedMs: 50,
          stopMacroReplay,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopMacroReplay).toHaveBeenCalledOnce();
  });

  it("deletes a saved macro", async () => {
    const deleteMacro = vi.fn().mockResolvedValue(undefined);
    render(
      <DebuggerContent
        tab="macros"
        session={session({ macros: [macro], deleteMacro })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete My macro" }));
    await waitFor(() => expect(deleteMacro).toHaveBeenCalledWith(macro.id));
  });
});
