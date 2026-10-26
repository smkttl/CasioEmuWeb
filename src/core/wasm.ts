import type {
  Breakpoint,
  CallFrame,
  CoreCapabilities,
  CoreModelInfo,
  DebugSnapshot,
  DisassemblyLine,
  EmulatorCore,
  FrameState,
  ModelRecord,
  RegisterState,
  SnapshotNode,
} from "./types";

interface CoreModule {
  HEAPU8: Uint8Array;
  UTF8ToString(pointer: number): string;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _ce_begin_model(): number;
  _ce_add_resource(path: number, data: number, length: number): number;
  _ce_load_model(): number;
  _ce_model_info_json(): number;
  _ce_shutdown(): void;
  _ce_start(): number;
  _ce_pause(paused: number): number;
  _ce_reset(): number;
  _ce_tick_frame(): number;
  _ce_frame_ptr(): number;
  _ce_frame_width(): number;
  _ce_frame_height(): number;
  _ce_frame_has_status_row(): number;
  _ce_status_alpha_ptr(): number;
  _ce_status_alpha_len(): number;
  _ce_is_running(): number;
  _ce_is_paused(): number;
  _ce_set_display_color(r: number, g: number, b: number): void;
  _ce_set_key(kiko: number, pressed: number): number;
  _ce_release_all(): void;
  _ce_bind_key(keycode: number, kiko: number): number;
  _ce_unbind_key(keycode: number): number;
  _ce_handle_key(keycode: number, pressed: number): number;
  _ce_read_memory(address: number, length: number, out: number): number;
  _ce_write_memory(address: number, data: number, length: number): number;
  _ce_pc(): number;
  _ce_registers_json(): number;
  _ce_backtrace(): number;
  _ce_disassemble(address: number, count: number): number;
  _ce_add_execution_breakpoint(address: number): number;
  _ce_remove_execution_breakpoint(address: number): number;
  _ce_add_memory_breakpoint(
    address: number,
    write: number,
    compareData: number,
    data: number,
    mask: number,
    skipCount: number,
  ): number;
  _ce_remove_memory_breakpoint(address: number, write: number): number;
  _ce_breakpoints_json(): number;
  _ce_step_into(): number;
  _ce_step_over(): number;
  _ce_step_out(): number;
  _ce_continue(): number;
  _ce_run_to(address: number): number;
  _ce_stop_reason(): number;
  _ce_snapshot_ptr(): number;
  _ce_snapshot_len(): number;
  _ce_save_snapshot(): number;
  _ce_restore_snapshot(data: number, length: number): number;
  _ce_save_persistent(out: number, capacity: number): number;
  _ce_load_persistent(data: number, length: number): number;
  _ce_has_native_debugger(): number;
  _ce_last_error(): number;
  _ce_model_hardware(): number;
}

type CoreFactory = {
  (options?: {
    locateFile?: (path: string) => string;
    wasmBinary?: ArrayBuffer;
  }): Promise<CoreModule>;
};

type CoreGlobal = typeof globalThis & {
  CasioEmuCoreModule?: CoreFactory;
};

type CoreOptions = {
  locateFile?: (path: string) => string;
  wasmBinary?: ArrayBuffer;
};

const CORE_BASE_URL = new URL(`${import.meta.env.BASE_URL}core/`, window.location.href);
const CORE_URL = new URL("casioemu-core.js", CORE_BASE_URL);
const CORE_WASM_URL = new URL("casioemu-core.wasm", CORE_BASE_URL);

let modulePromise: Promise<CoreModule> | null = null;

function resolveFactory(source: string): CoreFactory {
  const global = globalThis as CoreGlobal;
  try {
    // The Emscripten modular build assigns its factory to a global and also
    // supports CommonJS. Evaluating it directly avoids blob-module MIME/CSP
    // differences between file, Vite dev, and static deployments.
    new Function(source)();
    const factory = global.CasioEmuCoreModule;
    if (typeof factory !== "function") {
      throw new Error("The WebAssembly core did not expose its module factory.");
    }
    return factory;
  } catch (error) {
    delete global.CasioEmuCoreModule;
    throw error;
  }
}

function createCoreFactory(source: string, workerSource: string): CoreFactory {
  return (options: CoreOptions = {}) =>
    resolveFactory(
      `${source}\n${workerSource}\nglobalThis.CasioEmuCoreModule = CasioEmuCoreModule;`,
    )(options);
}

async function loadCoreModule(): Promise<CoreModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const response = await fetch(CORE_URL);
      if (!response.ok) {
        throw new Error(
          `WebAssembly core is unavailable (${response.status}). Run npm run core:build.`,
        );
      }
      const [source, wasmResponse] = await Promise.all([
        response.text(),
        fetch(CORE_WASM_URL),
      ]);
      if (!wasmResponse.ok) {
        throw new Error(
          `WebAssembly binary is unavailable (${wasmResponse.status}). Run npm run core:build.`,
        );
      }
      const wasmBinary = await wasmResponse.arrayBuffer();
      const factory = createCoreFactory(source, "");
      return await factory({
        locateFile: (path: string) => new URL(path, CORE_BASE_URL).href,
        wasmBinary,
      });
    })().catch((error) => {
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

function withCString<T>(module: CoreModule, value: string, action: (ptr: number) => T): T {
  const bytes = new TextEncoder().encode(`${value}\0`);
  const ptr = module._malloc(bytes.byteLength);
  try {
    module.HEAPU8.set(bytes, ptr);
    return action(ptr);
  } finally {
    module._free(ptr);
  }
}

function withBytes<T>(module: CoreModule, value: Uint8Array, action: (ptr: number) => T): T {
  const ptr = module._malloc(Math.max(1, value.byteLength));
  try {
    module.HEAPU8.set(value, ptr);
    return action(ptr);
  } finally {
    module._free(ptr);
  }
}

function readString(module: CoreModule, ptr: number): string {
  return ptr ? module.UTF8ToString(ptr) : "";
}

function coreError(module: CoreModule, fallback: string): Error {
  const message = readString(module, module._ce_last_error());
  return new Error(message || fallback);
}

export function parseRegisters(json: string): RegisterState {
  const raw = JSON.parse(json) as Record<string, number>;
  const r = Array.from({ length: 16 }, (_, index) => raw[`r${index}`] ?? 0);
  const er = Array.from({ length: 8 }, (_, index) => {
    const low = r[index * 2] ?? 0;
    const high = r[index * 2 + 1] ?? 0;
    return ((high & 0xff) << 8) | (low & 0xff);
  });
  const flags: string[] = [];
  if (raw.psw !== undefined) flags.push(`PSW ${raw.psw.toString(16).toUpperCase()}`);
  if (raw.dsr !== undefined) flags.push(`DSR ${raw.dsr.toString(16).toUpperCase()}`);
  return {
    r,
    er,
    pc: raw.pc ?? 0,
    sp: raw.sp ?? 0,
    ea: raw.ea ?? 0,
    lr: raw.lr ?? 0,
    psw: raw.psw ?? 0,
    dsr: raw.dsr ?? 0,
    csr: raw.csr ?? 0,
    flags,
  };
}

function parseDisassembly(json: string): DisassemblyLine[] {
  const raw = JSON.parse(json || "[]") as Array<{
    address: number;
    bytes: string;
    text: string;
  }>;
  return raw.map((line) => ({ ...line, isLabel: false }));
}

function parseBreakpoints(json: string): Breakpoint[] {
  const raw = JSON.parse(json || "{}") as {
    execution?: number[];
    memory?: Array<{ address: number; write: boolean; enabled: boolean; hitCount: number }>;
  };
  return [
    ...(raw.execution ?? []).map((address) => ({
      id: `exec-${address}`,
      address,
      enabled: true,
      kind: "execution" as const,
    })),
    ...(raw.memory ?? []).map((breakpoint) => ({
      id: `${breakpoint.write ? "write" : "read"}-${breakpoint.address}`,
      address: breakpoint.address,
      enabled: breakpoint.enabled,
      kind: breakpoint.write ? ("memory-write" as const) : ("memory-read" as const),
      hitCount: breakpoint.hitCount,
    })),
  ];
}

function parseBacktrace(text: string): CallFrame[] {
  const frames: CallFrame[] = [];
  const expression = /(?:0x)?([0-9A-Fa-f]{1,8})/g;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const matches = [...line.matchAll(expression)];
    if (!matches.length) continue;
    const address = Number.parseInt(matches[0][1], 16);
    const returnAddress = matches[1] ? Number.parseInt(matches[1][1], 16) : address;
    frames.push({ address, returnAddress, label: line.trim() });
  }
  return frames;
}

const KEY_CODE_NAMES: Record<string, number> = {
  Escape: 27,
  Enter: 13,
  Return: 13,
  Backspace: 8,
  Tab: 9,
  Space: 32,
  Delete: 46,
  Insert: 45,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  NumpadEnter: 13,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadMultiply: 106,
  NumpadDivide: 111,
  NumpadDecimal: 110,
  Equal: 187,
  Minus: 189,
  Slash: 191,
  Period: 190,
  Comma: 188,
  Semicolon: 186,
  Quote: 222,
  BracketLeft: 219,
  BracketRight: 221,
  Backslash: 220,
  Backquote: 192,
};

export function keyCodeFor(name: string): number | null {
  const value = name.trim();
  if (!value) return null;
  if (KEY_CODE_NAMES[value] !== undefined) return KEY_CODE_NAMES[value];
  if (/^F(?:[1-9]|1[0-2])$/.test(value)) {
    return 111 + Number.parseInt(value.slice(1), 10);
  }
  if (/^[A-Z]$/.test(value)) return value.charCodeAt(0);
  if (/^[0-9]$/.test(value)) return value.charCodeAt(0);
  if (/^Digit[0-9]$/.test(value)) return value.charCodeAt(5);
  if (/^Key[A-Z]$/.test(value)) return value.charCodeAt(3);
  if (/^Numpad[0-9]$/.test(value)) return 96 + Number.parseInt(value.slice(6), 10);
  if (value === "+" || value === "=") return 187;
  if (value === "-") return 189;
  if (value === "*") return 106;
  if (value === "/") return 111;
  if (value === ".") return 190;
  const keypad = /^(?:Keypad|Numpad) (.+)$/i.exec(value);
  if (keypad) {
    const label = keypad[1];
    const mapped: Record<string, number> = {
      Enter: 13,
      Add: 107,
      Subtract: 109,
      Multiply: 106,
      Divide: 111,
      Decimal: 110,
    };
    return mapped[label] ?? null;
  }
  return null;
}

export class WasmEmulatorCore implements EmulatorCore {
  private module: CoreModule | null = null;
  private frameRevision = 0;
  private lastFrame: FrameState = {
    width: 0,
    height: 0,
    pixels: new Uint8ClampedArray(),
    statusAlpha: new Uint8Array(),
    statusWidth: 0,
    statusHeight: 0,
    revision: 0,
    running: false,
    paused: true,
  };
  private modelInfo: CoreModelInfo = {};
  private coreCapabilities: CoreCapabilities = {
    native: false,
    debugger: false,
    snapshots: false,
    memory: false,
    disassembly: false,
    reason: "Core not loaded.",
  };
  private tickScheduled = false;
  private disposed = false;

  get capabilities() {
    return this.coreCapabilities;
  }

  get coreReady() {
    return this.module !== null;
  }

  async loadModel(record: ModelRecord): Promise<void> {
    this.disposed = false;
    this.tickScheduled = false;
    const module = await loadCoreModule();
    this.module = module;
    if (module._ce_begin_model() !== 0) throw coreError(module, "Could not begin model.");
    for (const file of record.files) {
      const path = withCString(module, file.path, (pathPtr) =>
        withBytes(module, file.bytes, (bytesPtr) =>
          module._ce_add_resource(pathPtr, bytesPtr, file.bytes.byteLength),
        ),
      );
      if (path !== 0) throw coreError(module, `Could not stage ${file.path}.`);
    }
    if (module._ce_load_model() !== 0) throw coreError(module, "Could not load model.");
    const canonical = readString(module, module._ce_model_info_json());
    if (canonical) {
      try {
        const info = JSON.parse(canonical) as CoreModelInfo;
        this.modelInfo = info;
        if (info.capabilities) this.coreCapabilities = info.capabilities;
      } catch {
        // The native metadata is advisory; import validation remains authoritative.
      }
    }
    module._ce_set_display_color(
      record.manifest.inkColor.r,
      record.manifest.inkColor.g,
      record.manifest.inkColor.b,
    );
    this.tickFrame();
  }

  async start(): Promise<void> {
    const module = this.requireModule();
    if (module._ce_start() !== 0) throw coreError(module, "Could not start the core.");
    this.scheduleTicks();
  }

  pause(paused: boolean): void {
    if (!this.module) return;
    this.module._ce_pause(paused ? 1 : 0);
    if (!paused) this.scheduleTicks();
  }

  async reset(): Promise<void> {
    const module = this.requireModule();
    if (module._ce_reset() !== 0) throw coreError(module, "Could not reset the core.");
    this.tickFrame();
  }

  async stop(): Promise<void> {
    if (!this.module) return;
    this.tickScheduled = false;
    this.module._ce_shutdown();
    this.module = null;
    this.coreCapabilities = {
      native: false,
      debugger: false,
      snapshots: false,
      memory: false,
      disassembly: false,
      reason: "Core stopped.",
    };
  }

  setKey(kiko: number, pressed: boolean): void {
    this.module?._ce_set_key(kiko, pressed ? 1 : 0);
  }

  bindKey(code: string, kiko: number): void {
    if (!this.module) return;
    const keycode = keyCodeFor(code);
    if (keycode !== null) this.module._ce_bind_key(keycode, kiko);
  }

  unbindKey(code: string): void {
    if (!this.module) return;
    const keycode = keyCodeFor(code);
    if (keycode !== null) this.module._ce_unbind_key(keycode);
  }

  handleKey(code: string, pressed: boolean): boolean {
    if (!this.module) return false;
    const keycode = keyCodeFor(code);
    return keycode !== null && this.module._ce_handle_key(keycode, pressed ? 1 : 0) === 0;
  }

  releaseAll(): void {
    this.module?._ce_release_all();
  }

  readFrame(): FrameState {
    if (!this.module) return this.lastFrame;
    const width = this.module._ce_frame_width();
    const height = this.module._ce_frame_height();
    const pointer = this.module._ce_frame_ptr();
    if (width <= 0 || height <= 0 || !pointer) return this.lastFrame;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.set(
      this.module.HEAPU8.subarray(pointer, pointer + pixels.byteLength),
    );
    const statusPointer = this.module._ce_status_alpha_ptr();
    const statusLength = this.module._ce_status_alpha_len();
    const statusAlpha =
      statusPointer && statusLength > 0
        ? this.module.HEAPU8.slice(statusPointer, statusPointer + statusLength)
        : new Uint8Array();
    const statusColumns = Math.min(width, Math.max(1, statusLength));
    const statusSprites = this.module._ce_frame_has_status_row()
      ? statusLength
      : 0;
    this.frameRevision += 1;
    this.lastFrame = {
      width,
      height,
      pixels,
      statusAlpha,
      statusWidth: statusSprites > 0 ? statusColumns : 0,
      statusHeight: statusSprites > 0 ? 1 : 0,
      revision: this.frameRevision,
      running: this.module._ce_is_running() !== 0,
      paused: this.module._ce_is_paused() !== 0,
    };
    return this.lastFrame;
  }

  readModelInfo(): CoreModelInfo {
    return this.modelInfo;
  }

  async readDebugState(): Promise<DebugSnapshot> {
    const module = this.requireModule();
    const registers = parseRegisters(readString(module, module._ce_registers_json()));
    const pc = registers.pc;
    const disassembly = parseDisassembly(
      readString(module, module._ce_disassemble(Math.max(0, pc - 8), 16)),
    );
    const breakpoints = parseBreakpoints(readString(module, module._ce_breakpoints_json()));
    const callStack = parseBacktrace(readString(module, module._ce_backtrace()));
    const memory = await this.readMemory(0, 0x2000);
    return {
      registers,
      disassembly,
      breakpoints,
      callStack,
      memoryBase: 0,
      memory,
      paused: module._ce_is_paused() !== 0,
      stopReason: readString(module, module._ce_stop_reason()),
    };
  }

  async readMemory(base: number, length: number): Promise<Uint8Array> {
    const module = this.requireModule();
    if (length < 0 || length > 1 << 20) throw new Error("Memory read size is invalid.");
    const result = new Uint8Array(length);
    const ptr = module._malloc(Math.max(1, length));
    try {
      const read = module._ce_read_memory(base, length, ptr);
      if (read < 0) throw coreError(module, "Memory read failed.");
      result.set(module.HEAPU8.subarray(ptr, ptr + read));
      return result;
    } finally {
      module._free(ptr);
    }
  }

  async writeMemory(base: number, bytes: Uint8Array): Promise<void> {
    const module = this.requireModule();
    withBytes(module, bytes, (ptr) => {
      if (module._ce_write_memory(base, ptr, bytes.byteLength) < 0) {
        throw coreError(module, "Memory write failed. Pause the emulator first.");
      }
    });
  }

  async addBreakpoint(breakpoint: Breakpoint): Promise<void> {
    const module = this.requireModule();
    const result =
      breakpoint.kind === "execution"
        ? module._ce_add_execution_breakpoint(breakpoint.address)
        : module._ce_add_memory_breakpoint(
            breakpoint.address,
            breakpoint.kind === "memory-write" ? 1 : 0,
            breakpoint.compareData ? 1 : 0,
            breakpoint.data ?? 0,
            breakpoint.mask ?? 0xff,
            breakpoint.skipCount ?? 0,
          );
    if (result !== 0) throw coreError(module, "Could not add breakpoint.");
  }

  async removeBreakpoint(breakpoint: Breakpoint): Promise<void> {
    const module = this.requireModule();
    const result =
      breakpoint.kind === "execution"
        ? module._ce_remove_execution_breakpoint(breakpoint.address)
        : module._ce_remove_memory_breakpoint(
            breakpoint.address,
            breakpoint.kind === "memory-write" ? 1 : 0,
          );
    if (result !== 0) throw coreError(module, "Could not remove breakpoint.");
  }

  async toggleBreakpoint(address: number): Promise<Breakpoint[]> {
    const module = this.requireModule();
    const current = parseBreakpoints(readString(module, module._ce_breakpoints_json()));
    const existing = current.find(
      (breakpoint) => breakpoint.kind === "execution" && breakpoint.address === address,
    );
    if (existing) await this.removeBreakpoint(existing);
    else {
      await this.addBreakpoint({
        id: `exec-${address}`,
        address,
        enabled: true,
        kind: "execution",
      });
    }
    return parseBreakpoints(readString(module, module._ce_breakpoints_json()));
  }

  async stepInto(): Promise<void> {
    this.pause(true);
    const module = this.requireModule();
    if (module._ce_step_into() !== 0) throw coreError(module, "Step into failed.");
    this.tickFrame();
  }

  async stepOver(): Promise<void> {
    this.pause(true);
    const module = this.requireModule();
    if (module._ce_step_over() !== 0) throw coreError(module, "Step over failed.");
    this.tickFrame();
  }

  async stepOut(): Promise<void> {
    this.pause(true);
    const module = this.requireModule();
    if (module._ce_step_out() !== 0) throw coreError(module, "Step out failed.");
    this.tickFrame();
  }

  async continue(): Promise<void> {
    const module = this.requireModule();
    if (module._ce_continue() !== 0) throw coreError(module, "Continue failed.");
    this.scheduleTicks();
  }

  async runTo(address: number): Promise<void> {
    const module = this.requireModule();
    if (module._ce_run_to(address) !== 0) throw coreError(module, "Run-to failed.");
    this.scheduleTicks();
  }

  async saveSnapshot(label: string, parentId: string | null): Promise<SnapshotNode> {
    const module = this.requireModule();
    this.pause(true);
    if (module._ce_save_snapshot() !== 0) throw coreError(module, "Snapshot failed.");
    const pointer = module._ce_snapshot_ptr();
    const length = module._ce_snapshot_len();
    const bytes = module.HEAPU8.slice(pointer, pointer + length);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      createdAt: Date.now(),
      parentId,
      bytes,
    };
  }

  async restoreSnapshot(node: SnapshotNode): Promise<void> {
    const module = this.requireModule();
    withBytes(module, node.bytes, (ptr) => {
      if (module._ce_restore_snapshot(ptr, node.bytes.byteLength) !== 0) {
        throw coreError(module, "Snapshot restore failed.");
      }
    });
    this.tickFrame();
  }

  async savePersistentState(): Promise<Uint8Array> {
    const module = this.requireModule();
    const required = module._ce_save_persistent(0, 0);
    if (required < 0) throw coreError(module, "Persistent state is unavailable for this model.");
    const ptr = module._malloc(required);
    try {
      const written = module._ce_save_persistent(ptr, required);
      if (written < 0) throw coreError(module, "Could not save persistent state.");
      return module.HEAPU8.slice(ptr, ptr + written);
    } finally {
      module._free(ptr);
    }
  }

  async loadPersistentState(bytes: Uint8Array): Promise<void> {
    const module = this.requireModule();
    withBytes(module, bytes, (ptr) => {
      if (module._ce_load_persistent(ptr, bytes.byteLength) !== 0) {
        throw coreError(module, "Could not restore persistent state.");
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.tickScheduled = false;
    if (this.module) {
      this.module._ce_shutdown();
      this.module = null;
    }
  }

  private requireModule(): CoreModule {
    if (!this.module) throw new Error("No emulator model is loaded.");
    return this.module;
  }

  private tickFrame() {
    if (!this.module) return;
    this.module._ce_tick_frame();
  }

  private scheduleTicks() {
    if (this.tickScheduled || this.disposed) return;
    this.tickScheduled = true;
    const tick = () => {
      if (!this.module) {
        this.tickScheduled = false;
        return;
      }
      this.module._ce_tick_frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

export const core = new WasmEmulatorCore();
