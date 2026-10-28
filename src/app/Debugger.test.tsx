import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RamImportPreview } from "../core/ramFile";
import type { DebugSnapshot } from "../core/types";
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
    readMemory: vi.fn(),
    writeMemory: vi.fn(),
    addBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    saveSnapshot: vi.fn(),
    restoreSnapshot: vi.fn(),
    removeSnapshot: vi.fn(),
    downloadRam: vi.fn().mockResolvedValue(undefined),
    readRamFile: vi.fn(),
    restoreRam: vi.fn().mockResolvedValue(undefined),
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
