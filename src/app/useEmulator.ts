import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { core } from "../core/wasm";
import {
  deletePersistentState,
  getKeyBindingOverrides,
  getPersistentState,
  listSnapshots,
  saveKeyBindingOverrides,
  savePersistentState,
  saveSnapshot,
  setSetting,
  deleteSnapshot,
} from "../core/storage";
import {
  assignBinding,
  buttonBinding,
  bindingsForCore,
  resetBinding,
  type KeyBindingOverrides,
} from "../core/keyBindings";
import {
  decodeRamFile,
  encodeRamFile,
  ramFileName,
  type RamImportPreview,
} from "../core/ramFile";
import type {
  Breakpoint,
  CoreModelInfo,
  DebugSnapshot,
  FrameState,
  ModelButton,
  ModelRecord,
  SnapshotNode,
} from "../core/types";

export type EmulatorStatus = "idle" | "loading" | "running" | "paused" | "error";

export interface EmulatorSession {
  sessionKey: number;
  status: EmulatorStatus;
  message: string;
  frame: FrameState | null;
  debug: DebugSnapshot | null;
  snapshots: SnapshotNode[];
  modelInfo: CoreModelInfo | null;
  coreReady: boolean;
  start: () => Promise<void>;
  pause: (paused?: boolean) => void;
  reset: () => Promise<void>;
  stepInto: () => Promise<void>;
  stepOver: () => Promise<void>;
  stepOut: () => Promise<void>;
  continueRun: () => Promise<void>;
  runTo: (address: number) => Promise<void>;
  press: (kiko: number, pressed: boolean) => void;
  handleKey: (code: string, pressed: boolean) => boolean;
  releaseAll: () => void;
  buttons: ModelButton[];
  keyBindings: KeyBindingOverrides;
  setKeyBinding: (button: ModelButton, code: string) => Promise<void>;
  resetKeyBinding: (button: ModelButton) => Promise<void>;
  readMemory: (address: number, length: number) => Promise<Uint8Array>;
  writeMemory: (address: number, bytes: Uint8Array) => Promise<void>;
  addBreakpoint: (breakpoint: Breakpoint) => Promise<void>;
  removeBreakpoint: (breakpoint: Breakpoint) => Promise<void>;
  saveSnapshot: (label: string, parentId: string | null) => Promise<SnapshotNode>;
  restoreSnapshot: (node: SnapshotNode) => Promise<void>;
  removeSnapshot: (node: SnapshotNode) => Promise<void>;
  downloadRam: () => Promise<void>;
  readRamFile: (file: File) => Promise<RamImportPreview>;
  restoreRam: (preview: RamImportPreview) => Promise<void>;
  persistNow: () => Promise<void>;
}

const IDLE_STATUS = {
  status: "idle" as const,
  message: "No calculator is loaded.",
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useEmulator(record: ModelRecord | null): EmulatorSession {
  const [status, setStatus] = useState<EmulatorStatus>(IDLE_STATUS.status);
  const [message, setMessage] = useState(IDLE_STATUS.message);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [debug, setDebug] = useState<DebugSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotNode[]>([]);
  const [modelInfo, setModelInfo] = useState<CoreModelInfo | null>(null);
  const [keyBindings, setKeyBindings] = useState<KeyBindingOverrides>({});
  const keyBindingsRef = useRef<KeyBindingOverrides>({});
  const [sessionKey, setSessionKey] = useState(0);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);
  const recordRef = useRef<ModelRecord | null>(record);
  const loadGeneration = useRef(0);
  const frameLoopGeneration = useRef(0);
  const lastPersist = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    recordRef.current = record;
    const generation = ++loadGeneration.current;
    core.releaseAll();
    setSessionKey((value) => value + 1);
    startedRef.current = false;
    if (!record) {
      setStatus("idle");
      setMessage("No calculator is loaded.");
      setFrame(null);
      setDebug(null);
      setSnapshots([]);
      setModelInfo(null);
      keyBindingsRef.current = {};
      setKeyBindings({});
      return;
    }

    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      setMessage("Preparing model…");
      setModelInfo(null);
      try {
        await core.loadModel(record);
        if (cancelled || generation !== loadGeneration.current) return;
        const info = core.readModelInfo();
        setModelInfo(info);
        const buttons = info.buttons ?? record.manifest.buttons;
        const savedBindings = await getKeyBindingOverrides(record.id);
        if (cancelled || generation !== loadGeneration.current) return;
        keyBindingsRef.current = savedBindings;
        setKeyBindings(savedBindings);
        for (const binding of bindingsForCore(buttons, savedBindings)) {
          if (binding.code) core.bindKey(binding.code, binding.button.kiko);
        }
        const persistent = await getPersistentState(record.id);
        if (persistent?.byteLength) {
          await core.loadPersistentState(persistent);
        }
        const savedSnapshots = await listSnapshots(record.id);
        if (cancelled || generation !== loadGeneration.current) return;
        setSnapshots(savedSnapshots);
        const initial = await core.readDebugState();
        if (cancelled || generation !== loadGeneration.current) return;
        setDebug(initial);
        setFrame(core.readFrame());
        setStatus("paused");
        setMessage("Model ready. Press RUN or a key to begin.");
        forceRender();
      } catch (error) {
        if (cancelled || generation !== loadGeneration.current) return;
        setStatus("error");
        setMessage(getErrorMessage(error));
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (generation === loadGeneration.current) {
        loadGeneration.current += 1;
        core.dispose();
      }
    };
  }, [record]);

  useEffect(() => {
    if (!record) return;
    const generation = ++frameLoopGeneration.current;
    let animation = 0;
    let previousRevision = -1;
    let lastDebugAt = 0;
    const loop = (now: number) => {
      if (
        generation !== frameLoopGeneration.current ||
        recordRef.current?.id !== record.id
      ) {
        return;
      }
      try {
        const next = core.readFrame();
        if (next.revision !== previousRevision) {
          previousRevision = next.revision;
          setFrame(next);
        }
        if (core.coreReady && now - lastDebugAt > 220) {
          lastDebugAt = now;
          void core.readDebugState().then((nextDebug) => {
            if (recordRef.current?.id === record.id) setDebug(nextDebug);
          });
        }
        if (next.running) {
          setStatus((current) => (current === "running" || current === "paused" ? current : "running"));
        }
      } catch {
        // The core reports fatal load errors through the session state.
      }
      animation = requestAnimationFrame(loop);
    };
    animation = requestAnimationFrame(loop);
    return () => {
      frameLoopGeneration.current += 1;
      cancelAnimationFrame(animation);
    };
  }, [record]);

  const start = useCallback(async () => {
    if (!recordRef.current) return;
    setStatus("running");
    setMessage("Running.");
    try {
      await core.start();
      startedRef.current = true;
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    }
  }, []);

  const pause = useCallback((paused = true) => {
    core.pause(paused);
    setStatus(paused ? "paused" : "running");
    setMessage(paused ? "Paused." : "Running.");
  }, []);

  const reset = useCallback(async () => {
    if (!recordRef.current) return;
    try {
      await core.reset();
      setFrame(core.readFrame());
      setDebug(await core.readDebugState());
      setStatus("paused");
      setMessage("Calculator reset.");
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    }
  }, []);

  const runStep = useCallback(async (step: () => Promise<void>, label: string) => {
    if (!recordRef.current) return;
    try {
      await step();
      setFrame(core.readFrame());
      setDebug(await core.readDebugState());
      setStatus("paused");
      setMessage(label);
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    }
  }, []);

  const stepInto = useCallback(() => runStep(() => core.stepInto(), "Stepped into."), [runStep]);
  const stepOver = useCallback(() => runStep(() => core.stepOver(), "Stepped over."), [runStep]);
  const stepOut = useCallback(() => runStep(() => core.stepOut(), "Stepped out."), [runStep]);
  const continueRun = useCallback(async () => {
    try {
      await core.continue();
      setStatus("running");
      setMessage("Continuing.");
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    }
  }, []);
  const runTo = useCallback(
    async (address: number) => {
      try {
        await core.runTo(address);
        setStatus("running");
        setMessage(`Running to ${address.toString(16).toUpperCase()}.`);
      } catch (error) {
        setStatus("error");
        setMessage(getErrorMessage(error));
      }
    },
    [],
  );

  const press = useCallback((kiko: number, pressed: boolean) => {
    if (!recordRef.current) return;
    core.setKey(kiko, pressed);
    if (pressed && !startedRef.current) {
      startedRef.current = true;
      void core.start().then(() => {
        setStatus("running");
        setMessage("Running.");
      });
    }
  }, []);

  const releaseAll = useCallback(() => core.releaseAll(), []);

  const handleKey = useCallback((code: string, pressed: boolean) => {
    return core.handleKey(code, pressed);
  }, []);

  const buttons = useMemo(
    () => modelInfo?.buttons ?? record?.manifest.buttons ?? [],
    [modelInfo, record],
  );

  const setKeyBinding = useCallback(
    async (button: ModelButton, code: string) => {
      const active = recordRef.current;
      if (!active) return;
      const previous = keyBindingsRef.current;
      const previousCode = buttonBinding(button, previous);
      const next = assignBinding(previous, button, buttons, code);
      if (previousCode) core.unbindKey(previousCode);
      core.releaseAll();
      const nextBindings = bindingsForCore(buttons, next);
      for (const binding of nextBindings) {
        if (binding.code) core.bindKey(binding.code, binding.button.kiko);
      }
      keyBindingsRef.current = next;
      setKeyBindings(next);
      await saveKeyBindingOverrides(active.id, next);
    },
    [buttons],
  );

  const resetKeyBinding = useCallback(
    async (button: ModelButton) => {
      const active = recordRef.current;
      if (!active) return;
      const previous = keyBindingsRef.current;
      const next = resetBinding(previous, button);
      const previousCode = buttonBinding(button, previous);
      const nextCode = buttonBinding(button, next);
      if (previousCode) core.unbindKey(previousCode);
      core.releaseAll();
      if (nextCode) core.bindKey(nextCode, button.kiko);
      keyBindingsRef.current = next;
      setKeyBindings(next);
      await saveKeyBindingOverrides(active.id, next);
    },
    [],
  );

  const persistNow = useCallback(async () => {
    const active = recordRef.current;
    if (!active) return;
    try {
      const bytes = await core.savePersistentState();
      await savePersistentState(active.id, bytes);
      lastPersist.current = Date.now();
    } catch {
      // Some hardware families do not expose battery-backed state.
    }
  }, []);

  const saveSnapshotNow = useCallback(
    async (label: string, parentId: string | null) => {
      const active = recordRef.current;
      if (!active) throw new Error("No calculator is loaded.");
      const node = await core.saveSnapshot(label, parentId);
      await saveSnapshot(active.id, node);
      setSnapshots((current) => [...current, node]);
      return node;
    },
    [],
  );

  const restoreSnapshotNow = useCallback(async (node: SnapshotNode) => {
    await core.restoreSnapshot(node);
    setFrame(core.readFrame());
    setDebug(await core.readDebugState());
    setStatus("paused");
    setMessage(`Restored “${node.label}”.`);
  }, []);

  const removeSnapshotNow = useCallback(
    async (node: SnapshotNode) => {
      const active = recordRef.current;
      if (!active) return;
      await deleteSnapshot(active.id, node.id);
      setSnapshots((current) => current.filter((item) => item.id !== node.id));
    },
    [],
  );

  const downloadRam = useCallback(async () => {
    const active = recordRef.current;
    if (!active) throw new Error("No calculator is loaded.");
    core.pause(true);
    const exportedAt = new Date();
    const payload = await core.savePersistentState();
    const bytes = encodeRamFile(
      payload,
      {
        modelId: active.id,
        modelName: active.name,
        hardwareId: active.hardwareId,
      },
      exportedAt,
    );
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = ramFileName(active.name, exportedAt);
    link.click();
    URL.revokeObjectURL(url);
    setStatus("paused");
    setMessage(`Saved RAM to ${link.download}.`);
  }, []);

  const readRamFile = useCallback(async (file: File) => {
    const active = recordRef.current;
    if (!active) throw new Error("No calculator is loaded.");
    return decodeRamFile(new Uint8Array(await file.arrayBuffer()), active, file.name);
  }, []);

  const restoreRam = useCallback(async (preview: RamImportPreview) => {
    const active = recordRef.current;
    if (!active) throw new Error("No calculator is loaded.");
    core.pause(true);
    const previous = await getPersistentState(active.id);
    try {
      await core.loadPersistentState(preview.payload);
      await savePersistentState(active.id, preview.payload);
      lastPersist.current = Date.now();
      setFrame(core.readFrame());
      setDebug(await core.readDebugState());
      setStatus("paused");
      setMessage(`Loaded RAM from ${preview.fileName}.`);
    } catch (error) {
      if (previous?.byteLength) {
        try {
          await core.loadPersistentState(previous);
          await savePersistentState(active.id, previous);
        } catch {
          // Report the original import failure.
        }
      } else {
        try {
          await deletePersistentState(active.id);
        } catch {
          // Report the original import failure.
        }
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (status === "running" && Date.now() - lastPersist.current > 30_000) {
        void persistNow();
      }
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void persistNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistNow, status]);

  useEffect(() => {
    if (status === "running") void setSetting("lastModelId", recordRef.current?.id ?? "");
  }, [status]);

  return {
    sessionKey,
    status,
    message,
    frame,
    debug,
    snapshots,
    modelInfo,
    coreReady: status !== "loading" && status !== "idle" && status !== "error",
    start,
    pause,
    reset,
    stepInto,
    stepOver,
    stepOut,
    continueRun,
    runTo,
    press,
    handleKey,
    releaseAll,
    buttons,
    keyBindings,
    setKeyBinding,
    resetKeyBinding,
    readMemory: (address, length) => core.readMemory(address, length),
    writeMemory: (address, bytes) => core.writeMemory(address, bytes),
    addBreakpoint: (breakpoint) => core.addBreakpoint(breakpoint),
    removeBreakpoint: (breakpoint) => core.removeBreakpoint(breakpoint),
    saveSnapshot: saveSnapshotNow,
    restoreSnapshot: restoreSnapshotNow,
    removeSnapshot: removeSnapshotNow,
    downloadRam,
    readRamFile,
    restoreRam,
    persistNow,
  };
}
