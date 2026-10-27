import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bug } from "lucide-react";
import type { ImportPreview, ModelRecord } from "../core/types";
import {
  deleteModel,
  getModel,
  getSetting,
  listModels,
  saveModel,
  setSetting,
} from "../core/storage";
import { ImportScreen } from "./ImportScreen";
import { CalculatorStage } from "./CalculatorStage";
import { Debugger } from "./Debugger";
import { applyCoreModelInfo, skinFor } from "./calculatorModel";
import { useEmulator } from "./useEmulator";
import {
  KeyChordTracker,
  isReservedKeyCode,
  keyChordFromEvent,
} from "../core/keyBindings";

export function App() {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [active, setActive] = useState<ModelRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileDebugOpen, setMobileDebugOpen] = useState(false);
  const session = useEmulator(active);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const activeModel = useMemo(
    () => (active ? applyCoreModelInfo(active, session.modelInfo) : null),
    [active, session.modelInfo],
  );
  const skin = useMemo(() => (activeModel ? skinFor(activeModel) : null), [activeModel]);

  const refreshModels = useCallback(async () => {
    setModels(await listModels());
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await listModels();
        setModels(stored);
        const lastId = await getSetting("lastModelId", "");
        const shouldReopen = await getSetting("reopenLastModel", true);
        if (shouldReopen && lastId) {
          const last = stored.find((model) => model.id === lastId) ?? (await getModel(lastId));
          if (last) setActive(last);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onImported = async (preview: ImportPreview) => {
    await saveModel(preview.record);
    await refreshModels();
    setActive(preview.record);
  };

  const onSelect = (record: ModelRecord) => {
    setActive(record);
    void setSetting("lastModelId", record.id);
  };

  const onDelete = async (record: ModelRecord) => {
    await deleteModel(record.id);
    if (active?.id === record.id) setActive(null);
    await refreshModels();
  };

  const goBack = () => {
    void session.persistNow();
    setActive(null);
    setMobileDebugOpen(false);
    void setSetting("lastModelId", "");
  };

  useEffect(() => {
    const pressedChords = new KeyChordTracker();
    const onKeyDown = (event: KeyboardEvent) => {
      const current = sessionRef.current;
      if (!active) return;
      const target = event.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (inField) return;
      if (event.key === "F5") {
        event.preventDefault();
        void current.start();
      } else if (event.key === "F8") {
        event.preventDefault();
        current.pause(true);
      } else if (event.key === "F10") {
        event.preventDefault();
        void current.stepOver();
      } else if (event.key === "F11") {
        event.preventDefault();
        void current.stepInto();
      } else if (event.key === "F9") {
        event.preventDefault();
        if (current.debug) {
          void current.addBreakpoint({
            id: `exec-${current.debug.registers.pc}`,
            address: current.debug.registers.pc,
            enabled: true,
            kind: "execution",
          });
        }
      } else {
        const chord = keyChordFromEvent(event.code, event);
        if (pressedChords.isActive(event.code)) {
          event.preventDefault();
          return;
        }
        if (
          chord &&
          !isReservedKeyCode(chord) &&
          current.handleKey(chord, true)
        ) {
          pressedChords.press(event.code, chord);
          event.preventDefault();
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const chord = pressedChords.release(event.code);
      if (chord && sessionRef.current.handleKey(chord, false)) event.preventDefault();
    };
    const releasePressed = () => {
      for (const chord of pressedChords.clear()) {
        sessionRef.current.handleKey(chord, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releasePressed);
    return () => {
      releasePressed();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releasePressed);
    };
  }, [
    active,
  ]);

  if (loading) {
    return (
      <main className="boot-screen">
        <span className="spinner" />
        <p>Opening local workspace…</p>
      </main>
    );
  }

  if (!active || !activeModel || !skin) {
    return (
      <ImportScreen
        models={models}
        onImported={(preview) => void onImported(preview)}
        onSelect={onSelect}
        onDelete={(record) => void onDelete(record)}
      />
    );
  }

  return (
    <div className="workbench">
      <header className="workbench-bar">
        <div className="workbench-left">
          <button className="icon-button" onClick={goBack} aria-label="Back to library">
            <ArrowLeft size={17} />
          </button>
          <div className="wordmark">
            Casio<strong>Emu</strong><span>WEB</span>
          </div>
          <span className="model-pill">{activeModel.name}</span>
        </div>
        <div className="workbench-right">
          <span className="privacy-note">Local session · IndexedDB</span>
          <button
            className="mobile-only debug-toggle"
            onClick={() => setMobileDebugOpen(true)}
          >
            <Bug size={16} /> Debug
          </button>
        </div>
      </header>

      <div className={`workspace ${mobileDebugOpen ? "debug-open" : ""}`}>
        <CalculatorStage
          key={active.id}
          record={activeModel}
          skin={skin}
          frame={session.frame}
          running={session.status === "running"}
          coreReady={session.coreReady}
          status={session.message}
          onRun={() => void session.start()}
          onPause={() => session.pause(true)}
          onReset={() => void session.reset()}
          onPress={session.press}
          onReleaseAll={session.releaseAll}
          keyBindings={session.keyBindings}
          onSetKeyBinding={session.setKeyBinding}
          onResetKeyBinding={session.resetKeyBinding}
        />
        <Debugger
          key={`${active.id}-${session.sessionKey}`}
          session={session}
          mobileOpen={mobileDebugOpen}
          onClose={() => setMobileDebugOpen(false)}
        />
      </div>
      {mobileDebugOpen ? (
        <button
          className="sheet-scrim"
          aria-label="Close debugger"
          onClick={() => setMobileDebugOpen(false)}
        />
      ) : null}
    </div>
  );
}
