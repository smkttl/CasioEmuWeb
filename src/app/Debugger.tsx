import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Bookmark,
  Bug,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CornerDownRight,
  Crosshair,
  Cpu,
  Database,
  Gauge,
  Layers,
  ListChecks,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Square,
  StepForward,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  Breakpoint,
  DebugSnapshot,
  SnapshotNode,
} from "../core/types";
import type { RamImportPreview } from "../core/ramFile";
import {
  formatMacroSize,
  MACRO_REPLAY_SPEEDS,
  macroSpeedLabel,
  type KeyMacro,
} from "../core/macros";
import type { EmulatorSession } from "./useEmulator";

type DebugTab =
  | "state"
  | "disassembly"
  | "breakpoints"
  | "memory"
  | "stack"
  | "snapshots"
  | "macros";

const TABS: Array<{ id: DebugTab; label: string; icon: typeof Cpu }> = [
  { id: "state", label: "State", icon: Gauge },
  { id: "disassembly", label: "Code", icon: Crosshair },
  { id: "breakpoints", label: "Breaks", icon: CircleDot },
  { id: "memory", label: "Memory", icon: Database },
  { id: "stack", label: "Stack", icon: Layers },
  { id: "snapshots", label: "States", icon: Bookmark },
  { id: "macros", label: "Macros", icon: ListChecks },
];

function hex(value: number, width = 4) {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function registerGroups(debug: DebugSnapshot | null) {
  if (!debug) return [];
  const r = debug.registers.r;
  return [
    ["PC", debug.registers.pc],
    ["SP", debug.registers.sp],
    ["PSW", debug.registers.psw],
    ["DSR", debug.registers.dsr],
    ["CSR", debug.registers.csr],
    ...r.map((value, index) => [`R${index}`, value] as const),
  ] as Array<[string, number]>;
}

function MemoryView({ session, paused }: { session: EmulatorSession; paused: boolean }) {
  const [address, setAddress] = useState(0);
  const [length, setLength] = useState(256);
  const [bytes, setBytes] = useState<Uint8Array>(new Uint8Array());
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      setBytes(await session.readMemory(address, length));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    void load();
  }, [address, length, paused]);

  const rows = useMemo(() => {
    const result: Array<{ address: number; data: Uint8Array }> = [];
    for (let offset = 0; offset < bytes.byteLength; offset += 16) {
      result.push({ address: address + offset, data: bytes.subarray(offset, offset + 16) });
    }
    return result;
  }, [address, bytes]);

  const commit = async (rowAddress: number, index: number) => {
    const parsed = Number.parseInt(editValue, 16);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) {
      setError("Enter a hexadecimal byte between 00 and FF.");
      return;
    }
    try {
      const addressToWrite = rowAddress + index;
      await session.writeMemory(addressToWrite, new Uint8Array([parsed]));
      setEditing(null);
      setError("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="debug-pane memory-pane">
      <div className="memory-toolbar">
        <label>
          Address
          <input
            value={hex(address)}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 16);
              if (Number.isFinite(value)) setAddress(Math.max(0, value));
            }}
          />
        </label>
        <label>
          Length
          <select value={length} onChange={(event) => setLength(Number(event.target.value))}>
            <option value={128}>128 B</option>
            <option value={256}>256 B</option>
            <option value={512}>512 B</option>
            <option value={1024}>1 KB</option>
            <option value={4096}>4 KB</option>
          </select>
        </label>
        <button className="mini-button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {!paused ? <p className="pane-note">Pause the calculator to edit memory.</p> : null}
      {error ? <p className="pane-error">{error}</p> : null}
      <div className="memory-table">
        {rows.map((row) => (
          <div className="memory-row" key={row.address}>
            <span className="memory-address">{hex(row.address)}</span>
            <span className="memory-bytes">
              {[...row.data].map((value, index) => (
                <button
                  key={index}
                  className={`memory-byte ${editing === row.address + index ? "is-editing" : ""}`}
                  disabled={!paused}
                  onClick={() => {
                    setEditing(row.address + index);
                    setEditValue(hex(value, 2));
                  }}
                >
                  {editing === row.address + index ? (
                    <input
                      autoFocus
                      value={editValue}
                      maxLength={2}
                      onChange={(event) => setEditValue(event.target.value.toUpperCase())}
                      onBlur={() => void commit(row.address, index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void commit(row.address, index);
                        if (event.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    hex(value, 2)
                  )}
                </button>
              ))}
            </span>
            <span className="memory-ascii">
              {[...row.data]
                .map((value) => (value >= 32 && value < 127 ? String.fromCharCode(value) : "."))
                .join("")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DebuggerContentProps {
  tab: DebugTab;
  session: EmulatorSession;
}

export function DebuggerContent({
  tab,
  session,
}: DebuggerContentProps) {
  const debug = session.debug;
  const paused = session.status !== "running";
  const groups = registerGroups(debug);
  const [breakKind, setBreakKind] = useState<Breakpoint["kind"]>("execution");
  const [breakAddress, setBreakAddress] = useState("");
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotError, setSnapshotError] = useState("");
  const [ramPreview, setRamPreview] = useState<RamImportPreview | null>(null);
  const [ramMessage, setRamMessage] = useState("");
  const [ramError, setRamError] = useState("");

  if (!debug) {
    return (
      <div className="debug-empty">
        {session.status === "loading" ? <span className="spinner" /> : <Bug size={28} />}
        <p>{session.message}</p>
      </div>
    );
  }

  if (tab === "state") {
    return (
      <div className="debug-pane">
        <div className="register-grid">
          {groups.map(([name, value]) => (
            <div className="register-cell" key={name}>
              <span>{name}</span>
              <code>{hex(value)}</code>
            </div>
          ))}
        </div>
        <div className="state-footer">
          <div>
            <span>STOP REASON</span>
            <strong>{debug.stopReason.replaceAll("-", " ")}</strong>
          </div>
          <div>
            <span>FRAME</span>
            <strong>
              {session.frame?.width ?? 0} × {session.frame?.height ?? 0}
            </strong>
          </div>
          <div>
            <span>FLAGS</span>
            <strong>{debug.registers.flags.join(" · ") || "—"}</strong>
          </div>
        </div>
        <h4 className="pane-title">Next instructions</h4>
        <div className="disassembly compact">
          {debug.disassembly.slice(0, 8).map((line) => (
            <div
              key={`${line.address}-${line.text}`}
              className={line.address === debug.registers.pc ? "is-current" : ""}
            >
              <span>{hex(line.address)}</span>
              <code>{line.bytes}</code>
              <strong>{line.text}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === "disassembly") {
    return (
      <div className="debug-pane">
        <div className="pane-toolbar">
          <span>PC {hex(debug.registers.pc)}</span>
          <button
            className="mini-button"
            onClick={() => void session.runTo(debug.registers.pc)}
          >
            Run to PC
          </button>
        </div>
        <div className="disassembly">
          {debug.disassembly.map((line) => (
            <div
              key={`${line.address}-${line.text}`}
              className={line.address === debug.registers.pc ? "is-current" : ""}
            >
              <span>{hex(line.address)}</span>
              <code>{line.bytes}</code>
              <strong>{line.text}</strong>
              <button
                className="inline-break"
                title="Toggle execution breakpoint"
                onClick={() =>
                  void session.addBreakpoint({
                    id: `exec-${line.address}`,
                    address: line.address,
                    enabled: true,
                    kind: "execution",
                  })
                }
              >
                <CircleDot size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === "breakpoints") {
    return (
      <div className="debug-pane">
        <div className="breakpoint-form">
          <select
            value={breakKind}
            onChange={(event) => setBreakKind(event.target.value as Breakpoint["kind"])}
          >
            <option value="execution">Execution</option>
            <option value="memory-read">Memory read</option>
            <option value="memory-write">Memory write</option>
          </select>
          <input
            placeholder="Address (hex)"
            value={breakAddress}
            onChange={(event) => setBreakAddress(event.target.value)}
          />
          <button
            className="mini-button"
            disabled={!breakAddress.trim()}
            onClick={async () => {
              const address = Number.parseInt(breakAddress, 16);
              if (!Number.isFinite(address)) return;
              await session.addBreakpoint({
                id: `${breakKind}-${address}`,
                address,
                enabled: true,
                kind: breakKind,
              });
              setBreakAddress("");
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        {debug.breakpoints.length ? (
          <div className="breakpoint-list">
            {debug.breakpoints.map((breakpoint) => (
              <div key={breakpoint.id}>
                <CircleDot size={13} />
                <span>{breakpoint.kind.replaceAll("-", " ")}</span>
                <code>{hex(breakpoint.address)}</code>
                <button
                  className="icon-button"
                  onClick={() => void session.removeBreakpoint(breakpoint)}
                  aria-label="Remove breakpoint"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">No breakpoints. Add one above or click the dot in Code.</p>
        )}
      </div>
    );
  }

  if (tab === "memory") return <MemoryView session={session} paused={paused} />;

  if (tab === "stack") {
    return (
      <div className="debug-pane">
        {debug.callStack.length ? (
          <div className="stack-list">
            {debug.callStack.map((frame, index) => (
              <div key={`${frame.address}-${index}`}>
                <span className="stack-index">#{index}</span>
                <CornerDownRight size={14} />
                <code>{hex(frame.address)}</code>
                <span>{frame.label ?? `return ${hex(frame.returnAddress)}`}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">No call frames have been recorded yet.</p>
        )}
      </div>
    );
  }

  if (tab === "macros") return <MacroView session={session} />;

  return (
    <div className="debug-pane">
      <div className="pane-toolbar">
        <span>RAM FILES</span>
        <div className="snapshot-actions">
          <button
            className="mini-button"
            onClick={async () => {
              setRamMessage("");
              setRamError("");
              try {
                await session.downloadRam();
                setRamMessage("RAM file downloaded.");
              } catch (cause) {
                setRamError(
                  `Could not save RAM: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                );
              }
            }}
          >
            <Download size={14} /> Save RAM
          </button>
          <label className="mini-button file-button">
            <Upload size={14} /> Load RAM
            <input
              type="file"
              accept=".cewram,application/octet-stream"
              aria-label="Load RAM file"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setRamPreview(null);
                setRamMessage("");
                setRamError("");
                try {
                  setRamPreview(await session.readRamFile(file));
                } catch (cause) {
                  setRamError(
                    `Could not load RAM: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                  );
                }
              }}
            />
          </label>
        </div>
      </div>
      {ramPreview ? (
        <div className="ram-confirm" role="alertdialog" aria-label="Confirm RAM replacement">
          <p>
            Replace the current saved RAM with <code>{ramPreview.fileName}</code> from{" "}
            {ramPreview.metadata.modelName}?
          </p>
          <div>
            <button
              className="mini-button"
              onClick={async () => {
                const preview = ramPreview;
                setRamError("");
                try {
                  await session.restoreRam(preview);
                  setRamPreview(null);
                  setRamMessage(`Loaded RAM from ${preview.fileName}.`);
                } catch (cause) {
                  setRamError(
                    `Could not restore RAM: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                  );
                }
              }}
            >
              Replace RAM
            </button>
            <button className="mini-button" onClick={() => setRamPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {ramMessage ? (
        <p className="pane-note ram-success" role="status">
          {ramMessage}
        </p>
      ) : null}
      {ramError ? (
        <p className="pane-error" role="alert">
          {ramError}
        </p>
      ) : null}
      <div className="snapshot-form">
        <input
          placeholder="Snapshot label"
          value={snapshotLabel}
          onChange={(event) => setSnapshotLabel(event.target.value)}
        />
        <button
          className="mini-button"
          onClick={async () => {
            setSnapshotError("");
            try {
              await session.saveSnapshot(snapshotLabel.trim() || "Snapshot", null);
              setSnapshotLabel("");
            } catch (cause) {
              setSnapshotError(
                `Could not save state: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              );
            }
          }}
        >
          <Save size={14} /> Save state
        </button>
      </div>
      {snapshotError ? (
        <p className="pane-error" role="alert">
          {snapshotError}
        </p>
      ) : null}
      {session.snapshots.length ? (
        <div className="snapshot-tree">
          {session.snapshots.map((node) => (
            <SnapshotItem
              key={node.id}
              node={node}
              session={session}
              depth={node.parentId ? 1 : 0}
            />
          ))}
        </div>
      ) : (
        <p className="empty-note">Snapshots capture the full machine state and stay on this device.</p>
      )}
    </div>
  );
}

function MacroView({ session }: { session: EmulatorSession }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="debug-pane macro-pane">
      <div className="macro-recording-bar">
        <div>
          <span className={session.recording ? "macro-record-dot is-live" : "macro-record-dot"} />
          <strong>{session.recording ? "RECORDING" : "KEY MACROS"}</strong>
        </div>
        {session.recording ? (
          <button className="mini-button macro-stop" onClick={session.stopMacroRecording}>
            <Square size={12} /> Stop recording
          </button>
        ) : (
          <button
            className="mini-button"
            onClick={() => {
              setMessage("");
              setError("");
              session.startMacroRecording();
            }}
            disabled={Boolean(session.replayingMacroId)}
          >
            <Radio size={14} /> Record
          </button>
        )}
      </div>
      {session.recording ? (
        <p className="macro-live-status" role="status">
          {session.recordedEvents} events · {(session.recordingElapsedMs / 1000).toFixed(1)}s
          <span>Use calculator keys or the keyboard, then stop when finished.</span>
        </p>
      ) : null}
      {session.pendingRecording ? (
        <section className="macro-review" aria-label="Review recording">
          <div>
            <span>RECORDING READY</span>
            <strong>
              {session.pendingRecording.events.filter((event) => event.pressed).length}{" "}
              key presses ·{" "}
              {(
                (session.pendingRecording.events.at(-1)?.atMs ?? 0) / 1000
              ).toFixed(1)}
              s
            </strong>
          </div>
          <div className="macro-sequence">
            {session.pendingRecording.events
              .filter((event) => event.pressed)
              .map((event, index) => (
                <span key={`${event.kiko}-${event.atMs}-${index}`}>{event.label}</span>
              ))}
          </div>
          <input
            aria-label="Macro name"
            placeholder="Macro name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="macro-review-actions">
            <button
              className="mini-button"
              disabled={!name.trim()}
              onClick={async () => {
                setMessage("");
                setError("");
                try {
                  const saved = await session.saveMacroRecording(name);
                  setName("");
                  setMessage(`Saved “${saved.name}”.`);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              <Save size={14} /> Save macro
            </button>
            <button
              className="mini-button"
              onClick={() => {
                session.discardMacroRecording();
                setName("");
              }}
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}
      {message ? (
        <p className="pane-note macro-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="pane-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="macro-speed">
        <label htmlFor="macro-replay-speed">Replay speed</label>
        <select
          id="macro-replay-speed"
          value={session.replaySpeed}
          onChange={(event) => {
            const value = event.target.value;
            const speed = value === "instant" ? "instant" : Number(value) as 0.5 | 1 | 2;
            void session.setReplaySpeed(speed);
          }}
        >
          {MACRO_REPLAY_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {macroSpeedLabel(speed)}
            </option>
          ))}
        </select>
      </div>
      {session.macros.length ? (
        <div className="macro-list">
          {session.macros.map((macro) => (
            <MacroItem
              key={macro.id}
              macro={macro}
              session={session}
              onMessage={setMessage}
              onError={setError}
            />
          ))}
        </div>
      ) : (
        <p className="empty-note">
          Record a short sequence of calculator keys and replay it with one click.
          Macros stay on this device and are scoped to this model.
        </p>
      )}
    </div>
  );
}

function MacroItem({
  macro,
  session,
  onMessage,
  onError,
}: {
  macro: KeyMacro;
  session: EmulatorSession;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const replaying = session.replayingMacroId === macro.id;
  const progress =
    replaying && macro.durationMs
      ? Math.min(100, (session.replayElapsedMs / macro.durationMs) * 100)
      : 0;
  return (
    <article className={`macro-item ${replaying ? "is-replaying" : ""}`}>
      <div className="macro-item-main">
        <strong>{macro.name}</strong>
        <small>{formatMacroSize(macro)}</small>
        <div className="macro-labels">
          {macro.events
            .filter((event) => event.pressed)
            .slice(0, 12)
            .map((event, index) => (
              <span key={`${event.kiko}-${event.atMs}-${index}`}>{event.label}</span>
            ))}
          {macro.events.filter((event) => event.pressed).length > 12 ? (
            <span>+{macro.events.filter((event) => event.pressed).length - 12}</span>
          ) : null}
        </div>
        {replaying ? <div className="macro-progress" style={{ width: `${progress}%` }} /> : null}
      </div>
      <div className="macro-item-actions">
        {replaying ? (
          <button className="mini-button macro-stop" onClick={session.stopMacroReplay}>
            <Square size={12} /> Stop
          </button>
        ) : (
          <button
            className="mini-button macro-play"
            disabled={session.recording || Boolean(session.replayingMacroId)}
            onClick={() => {
              onError("");
              onMessage("");
              session.replayMacro(macro);
            }}
          >
            <Play size={13} /> Replay
          </button>
        )}
        <button
          className="icon-button"
          aria-label={`Delete ${macro.name}`}
          disabled={replaying}
          onClick={async () => {
            onError("");
            try {
              await session.deleteMacro(macro.id);
              onMessage(`Deleted “${macro.name}”.`);
            } catch (cause) {
              onError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function SnapshotItem({
  node,
  session,
  depth,
}: {
  node: SnapshotNode;
  session: EmulatorSession;
  depth: number;
}) {
  return (
    <div className="snapshot-row" style={{ paddingLeft: 10 + depth * 16 }}>
      {depth ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      <button className="snapshot-open" onClick={() => void session.restoreSnapshot(node)}>
        <strong>{node.label}</strong>
        <small>{new Date(node.createdAt).toLocaleTimeString()}</small>
      </button>
      <button
        className="icon-button"
        aria-label={`Delete ${node.label}`}
        onClick={() => void session.removeSnapshot(node)}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

interface DebuggerProps {
  session: EmulatorSession;
  mobileOpen: boolean;
  onClose: () => void;
}

export function Debugger({ session, mobileOpen, onClose }: DebuggerProps) {
  const [tab, setTab] = useState<DebugTab>("state");
  const paused = session.status !== "running";

  return (
    <aside className={`debugger ${mobileOpen ? "is-open" : ""}`} aria-label="Debugger">
      <div className="debugger-top">
        <div className="debugger-heading">
          <span className="live-dot" data-live={!paused} />
          <div>
            <strong>DEBUG CONSOLE</strong>
            <small>{session.message}</small>
          </div>
        </div>
        <button className="icon-button mobile-only" onClick={onClose} aria-label="Close debugger">
          <X size={17} />
        </button>
      </div>
      <div className="debug-controls">
        <button
          className="debug-run"
          onClick={() => (paused ? void session.continueRun() : session.pause(true))}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
          {paused ? "Continue" : "Pause"}
        </button>
        <button onClick={() => void session.stepInto()} disabled={!session.coreReady} title="Step into">
          <StepForward size={15} /> Step
        </button>
        <button onClick={() => void session.stepOver()} disabled={!session.coreReady} title="Step over">
          Over
        </button>
        <button onClick={() => void session.stepOut()} disabled={!session.coreReady} title="Step out">
          Out
        </button>
        <button
          className="icon-button"
          onClick={() => void session.reset()}
          disabled={!session.coreReady}
          title="Reset"
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <nav className="debug-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "is-active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <DebuggerContent tab={tab} session={session} />
      <div className="debug-footer">
        <span>F5 run · F8 pause · F10 step</span>
        <span className="core-chip">
          <Cpu size={12} /> {session.coreReady ? "WASM LIVE" : "CORE OFFLINE"}
        </span>
      </div>
    </aside>
  );
}
