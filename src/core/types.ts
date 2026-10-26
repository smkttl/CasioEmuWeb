export const HARDWARE_NAMES = {
  3: "ES / ES Plus",
  4: "ClassWiz",
  5: "ClassWiz II",
  6: "fx-5800P",
  7: "TI MathPrint",
  8: "Solar II",
  9: "EPS6800",
  10: "EPS6009",
  11: "EPS9500",
  12: "EPS6800 W192",
  13: "TI MultiView",
} as const;

export type HardwareId = keyof typeof HARDWARE_NAMES;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteInfo {
  src: Rect;
  dest: Rect;
  svgShape?: string;
  svgDefs?: string;
}

export interface StatusIndicator {
  sprite: string;
  byte: number;
  bit: number;
}

export interface ModelButton {
  id: string;
  rect: Rect;
  kiko: number;
  keyname: string;
  svgShape?: string;
  svgDefs?: string;
}

export interface ModelManifest {
  format?: string;
  version?: number;
  modelName: string;
  hardwareId: HardwareId;
  csrMask: number;
  realHardware: boolean;
  pdValue: number;
  interfacePath: string;
  boardPath: string;
  romPath: string;
  flashPath: string;
  inkColor: { r: number; g: number; b: number };
  enableNewScreen: boolean;
  isSampleRom: boolean;
  legacyKo: boolean;
  u16Mode: boolean;
  largeModel: boolean;
  ml620Mirroring: boolean;
  screenWidth: number;
  screenHeight: number;
  screenScaleY: number;
  sprites: Record<string, SpriteInfo>;
  statusSpriteIndexes: Record<string, number>;
  statusIndicators: StatusIndicator[];
  buttons: ModelButton[];
  extra: Record<string, string>;
  source: "json" | "bin";
}

export interface ModelFile {
  path: string;
  bytes: Uint8Array;
  type: string;
}

export interface ModelRecord {
  id: string;
  name: string;
  hardwareId: HardwareId;
  hardwareName: string;
  source: "json" | "bin";
  importedAt: number;
  updatedAt: number;
  manifest: ModelManifest;
  files: ModelFile[];
  bytes: number;
  romHash: string;
  gameBufferSupported: boolean;
  interfaceUrl?: string;
  boardSvg?: string;
  interfaceSvg?: string;
}

export interface StoredModelRecord {
  record: Omit<ModelRecord, "files" | "interfaceUrl">;
  files: Record<string, string>;
  fileTypes: Record<string, string>;
}

export interface ModelValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface ImportPreview {
  manifest: ModelManifest;
  files: ModelFile[];
  issues: ModelValidationIssue[];
  record: ModelRecord;
}

export interface FrameState {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  statusAlpha: Uint8Array;
  statusWidth: number;
  statusHeight: number;
  revision: number;
  running: boolean;
  paused: boolean;
}

export interface RegisterState {
  r: number[];
  er: number[];
  pc: number;
  sp: number;
  ea: number;
  lr: number;
  psw: number;
  dsr: number;
  csr: number;
  flags: string[];
}

export interface DisassemblyLine {
  address: number;
  bytes: string;
  text: string;
  isLabel: boolean;
  branchTarget?: number;
}

export interface Breakpoint {
  id: string;
  address: number;
  enabled: boolean;
  kind: "execution" | "memory-read" | "memory-write";
  hitCount?: number;
  skipCount?: number;
  compareData?: boolean;
  data?: number;
  mask?: number;
}

export interface CallFrame {
  address: number;
  returnAddress: number;
  label?: string;
}

export interface SnapshotNode {
  id: string;
  label: string;
  createdAt: number;
  parentId: string | null;
  bytes: Uint8Array;
  preview?: string;
}

export interface DebugSnapshot {
  registers: RegisterState;
  disassembly: DisassemblyLine[];
  breakpoints: Breakpoint[];
  callStack: CallFrame[];
  memoryBase: number;
  memory: Uint8Array;
  paused: boolean;
  stopReason: string;
}

export interface CoreCapabilities {
  native: boolean;
  debugger: boolean;
  snapshots: boolean;
  memory: boolean;
  disassembly: boolean;
  reason?: string;
}

export interface CoreModelInfo {
  format?: string;
  version?: number;
  modelName?: string;
  hardwareId?: HardwareId;
  hardwareName?: string;
  csrMask?: number;
  realHardware?: boolean;
  pdValue?: number;
  frame?: { width: number; height: number; hasStatusRow: boolean };
  capabilities?: CoreCapabilities;
  sprites?: Record<string, SpriteInfo>;
  statusSpriteIndexes?: Record<string, number>;
  statusIndicators?: StatusIndicator[];
  buttons?: ModelButton[];
  inkColor?: { r: number; g: number; b: number };
  boardPath?: string;
  interfacePath?: string;
  romPath?: string;
  flashPath?: string;
  enableNewScreen?: boolean;
  isSampleRom?: boolean;
  legacyKo?: boolean;
  u16Mode?: boolean;
  largeModel?: boolean;
  ml620Mirroring?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  screenScaleY?: number;
  source?: "json" | "bin";
  extra?: Record<string, string>;
}

export interface EmulatorCore {
  readonly capabilities: CoreCapabilities;
  readonly coreReady: boolean;
  loadModel(record: ModelRecord): Promise<void>;
  bindKey(code: string, kiko: number): void;
  unbindKey(code: string): void;
  handleKey(code: string, pressed: boolean): boolean;
  start(): Promise<void>;
  pause(paused: boolean): void;
  reset(): Promise<void>;
  stop(): Promise<void>;
  setKey(kiko: number, pressed: boolean): void;
  releaseAll(): void;
  readFrame(): FrameState;
  readModelInfo(): CoreModelInfo;
  readDebugState(): Promise<DebugSnapshot>;
  readMemory(base: number, length: number): Promise<Uint8Array>;
  writeMemory(base: number, bytes: Uint8Array): Promise<void>;
  addBreakpoint(breakpoint: Breakpoint): Promise<void>;
  removeBreakpoint(breakpoint: Breakpoint): Promise<void>;
  toggleBreakpoint(address: number): Promise<Breakpoint[]>;
  stepInto(): Promise<void>;
  stepOver(): Promise<void>;
  stepOut(): Promise<void>;
  continue(): Promise<void>;
  runTo(address: number): Promise<void>;
  saveSnapshot(label: string, parentId: string | null): Promise<SnapshotNode>;
  restoreSnapshot(node: SnapshotNode): Promise<void>;
  savePersistentState(): Promise<Uint8Array>;
  loadPersistentState(bytes: Uint8Array): Promise<void>;
  dispose(): void;
}

export const KEY_NAMES: Record<string, number> = {
  Escape: 27,
  Return: 13,
  Enter: 13,
  Backspace: 8,
  Tab: 9,
  Space: 32,
  Delete: 127,
  Left: 37,
  Up: 38,
  Right: 39,
  Down: 40,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
};
