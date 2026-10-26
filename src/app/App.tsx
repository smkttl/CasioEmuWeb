import { useCallback, useEffect, useMemo, useState } from "react";
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

export function App() {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [active, setActive] = useState<ModelRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileDebugOpen, setMobileDebugOpen] = useState(false);
  const session = useEmulator(active);
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
    const onKeyDown = (event: KeyboardEvent) => {
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
        void session.start();
      } else if (event.key === "F8") {
        event.preventDefault();
        session.pause(true);
      } else if (event.key === "F10") {
        event.preventDefault();
        void session.stepOver();
      } else if (event.key === "F11") {
        event.preventDefault();
        void session.stepInto();
      } else if (event.key === "F9") {
        event.preventDefault();
        if (session.debug) {
          void session.addBreakpoint({
            id: `exec-${session.debug.registers.pc}`,
            address: session.debug.registers.pc,
            enabled: true,
            kind: "execution",
          });
        }
      } else if (session.handleKey(event.code, true)) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (session.handleKey(event.code, false)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    active,
    session.pause,
    session.start,
    session.stepInto,
    session.stepOver,
    session.handleKey,
    session.debug,
    session.addBreakpoint,
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
