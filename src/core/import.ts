import { BinaryReader } from "./binary";
import {
  HARDWARE_NAMES,
  type HardwareId,
  type ImportPreview,
  type ModelFile,
  type ModelManifest,
  type ModelRecord,
  type ModelValidationIssue,
  type SpriteInfo,
} from "./types";

export const MAX_ARCHIVE_BYTES = 160 * 1024 * 1024;
export const MAX_FILE_BYTES = 96 * 1024 * 1024;
export const MAX_FILE_COUNT = 2048;

export interface ImportSource {
  files: ModelFile[];
  sourceName?: string;
}

const TEXT_EXTENSIONS = new Set([
  "json",
  "svg",
  "txt",
  "lua",
  "js",
  "css",
  "html",
  "xml",
  "md",
  "csv",
]);

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function validateModelPath(path: string): string | null {
  if (!path || path === ".") return "The file path is empty.";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "Absolute paths are not allowed.";
  if (path.includes("\\")) return "Backslashes are not allowed in model paths.";
  if (path.includes(":")) return "Drive or stream prefixes are not allowed in model paths.";
  if (path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    return "Parent, current, and empty path segments are not allowed.";
  }
  if (path.length > 512) return "The file path is too long.";
  return null;
}

function mimeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTENSIONS.has(extension)) {
    return extension === "svg" ? "image/svg+xml" : "text/plain";
  }
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function withFileType(file: ModelFile): ModelFile {
  return {
    ...file,
    path: normalizePath(file.path),
    type: file.type || mimeForPath(file.path),
  };
}

export function sanitizeModelFiles(files: ModelFile[]): {
  files: ModelFile[];
  issues: ModelValidationIssue[];
} {
  const issues: ModelValidationIssue[] = [];
  const result: ModelFile[] = [];
  const seen = new Map<string, string>();
  let total = 0;

  if (files.length > MAX_FILE_COUNT) {
    issues.push({
      path: "",
      severity: "error",
      message: `The model contains ${files.length} files; the limit is ${MAX_FILE_COUNT}.`,
    });
    return { files: [], issues };
  }

  for (const raw of files) {
    const file = withFileType(raw);
    const pathIssue = validateModelPath(file.path);
    if (pathIssue) {
      issues.push({ path: raw.path, severity: "error", message: pathIssue });
      continue;
    }
    if (file.bytes.byteLength > MAX_FILE_BYTES) {
      issues.push({
        path: file.path,
        severity: "error",
        message: `File is ${file.bytes.byteLength} bytes; the per-file limit is ${MAX_FILE_BYTES} bytes.`,
      });
      continue;
    }
    total += file.bytes.byteLength;
    if (total > MAX_ARCHIVE_BYTES) {
      issues.push({
        path: file.path,
        severity: "error",
        message: `The extracted model exceeds ${MAX_ARCHIVE_BYTES} bytes.`,
      });
      break;
    }
    const folded = file.path.toLowerCase();
    const previous = seen.get(folded);
    if (previous) {
      issues.push({
        path: file.path,
        severity: "error",
        message: `Path collides with ${previous} when case is ignored.`,
      });
      continue;
    }
    seen.set(folded, file.path);
    result.push(file);
  }

  return { files: result.sort((a, b) => a.path.localeCompare(b.path)), issues };
}

export function findConfigFile(files: ModelFile[]): ModelFile | undefined {
  return (
    files.find((file) => file.path === "config.json") ??
    files.find((file) => file.path === "config.bin")
  );
}

export function findModelRoot(files: ModelFile[]): string {
  const config = files.find(
    (file) =>
      file.path === "config.json" ||
      file.path === "config.bin" ||
      file.path.endsWith("/config.json") ||
      file.path.endsWith("/config.bin"),
  );
  if (!config) return "";
  const slash = config.path.lastIndexOf("/");
  return slash < 0 ? "" : config.path.slice(0, slash + 1);
}

export function stripModelRoot(files: ModelFile[], root: string): ModelFile[] {
  if (!root) return files;
  return files
    .filter((file) => file.path.startsWith(root))
    .map((file) => ({ ...file, path: file.path.slice(root.length) }));
}

export function serializeModelFiles(files: ModelFile[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of files) {
    result[file.path] = encodeBase64(file.bytes);
  }
  return result;
}

export function deserializeModelFiles(
  value: Record<string, string>,
  types: Record<string, string> = {},
): ModelFile[] {
  return Object.entries(value).map(([path, encoded]) => ({
    path,
    bytes: decodeBase64(encoded),
    type: types[path] ?? "",
  }));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.byteLength; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectBoardSprites(boardSvg: string): Record<string, SpriteInfo> {
  if (typeof DOMParser === "undefined") return {};
  const document = new DOMParser().parseFromString(boardSvg, "image/svg+xml");
  if (document.querySelector("parsererror")) return {};
  const sprites: Record<string, SpriteInfo> = {};
  for (const element of document.querySelectorAll("[id^='rsd_']")) {
    const id = element.getAttribute("id");
    if (!id) continue;
    const rect = element.getBoundingClientRect?.();
    if (!rect) continue;
    sprites[id] = {
      src: { x: 0, y: 0, w: Math.max(1, rect.width), h: Math.max(1, rect.height) },
      dest: { x: 0, y: 0, w: Math.max(1, rect.width), h: Math.max(1, rect.height) },
    };
  }
  return sprites;
}

export function manifestFromConfigJson(
  bytes: Uint8Array,
  boardSvg?: string,
): ModelManifest {
  const text = new TextDecoder().decode(bytes);
  const raw = JSON.parse(text) as Record<string, unknown>;
  const hardwareId = Number(raw.hardware_id) as HardwareId;
  if (!(hardwareId in HARDWARE_NAMES)) {
    throw new Error(`Unsupported hardware_id ${String(raw.hardware_id)}.`);
  }
  const ink = asRecord(raw.ink_color) ?? {};
  const sprites: Record<string, SpriteInfo> = {};
  const rawSprites = asRecord(raw.sprites);
  if (rawSprites) {
    for (const [name, value] of Object.entries(rawSprites)) {
      const sprite = asRecord(value);
      const src = asRecord(sprite?.src);
      const dest = asRecord(sprite?.dest);
      if (!src || !dest) continue;
      sprites[name] = {
        src: { x: Number(src.x), y: Number(src.y), w: Number(src.w), h: Number(src.h) },
        dest: { x: Number(dest.x), y: Number(dest.y), w: Number(dest.w), h: Number(dest.h) },
        svgShape: typeof sprite?.svg_shape === "string" ? sprite.svg_shape : undefined,
        svgDefs: typeof sprite?.svg_defs === "string" ? sprite.svg_defs : undefined,
      };
    }
  }
  const statusSpriteIndexes: Record<string, number> = {};
  for (const [name, value] of Object.entries(rawSprites ?? {})) {
    const sprite = asRecord(value);
    if (sprite && Number.isInteger(sprite.index)) statusSpriteIndexes[name] = Number(sprite.index);
  }
  const buttons = Array.isArray(raw.buttons)
    ? raw.buttons.flatMap((value, index) => {
        const button = asRecord(value);
        const rect = asRecord(button?.rect);
        if (!button || !rect) {
          return [
            {
              id: `config-${index}`,
              rect: { x: 0, y: 0, w: 1, h: 1 },
              kiko: Number(button?.kiko ?? -1),
              keyname: String(button?.keyname ?? ""),
            },
          ];
        }
        return [
          {
            id: `kiko-${Number(button.kiko)}`,
            rect: {
              x: Number(rect.x),
              y: Number(rect.y),
              w: Number(rect.w),
              h: Number(rect.h),
            },
            kiko: Number(button.kiko),
            keyname: String(button.keyname ?? ""),
            svgShape: typeof button.svg_shape === "string" ? button.svg_shape : undefined,
            svgDefs: typeof button.svg_defs === "string" ? button.svg_defs : undefined,
          },
        ];
      })
    : [];
  const statusIndicators = Array.isArray(raw.status)
    ? raw.status.flatMap((value) => {
        const item = asRecord(value);
        if (!item) return [];
        return [
          {
            sprite: String(item.sprite ?? ""),
            byte: Number(item.byte ?? 0),
            bit: Number(item.bit ?? 0),
          },
        ];
      })
    : [];
  if (boardSvg) {
    for (const [name, sprite] of Object.entries(collectBoardSprites(boardSvg))) {
      sprites[name] ??= sprite;
    }
  }
  return {
    format: typeof raw.format === "string" ? raw.format : undefined,
    version: typeof raw.version === "number" ? raw.version : undefined,
    modelName: String(raw.model_name ?? "Untitled model"),
    hardwareId,
    csrMask: Number(raw.csr_mask ?? 0),
    realHardware: Boolean(raw.real_hardware),
    pdValue: Number(raw.pd_value ?? 0),
    interfacePath: String(raw.interface_path ?? ""),
    boardPath: String(raw.board_path ?? ""),
    romPath: String(raw.rom_path ?? ""),
    flashPath: String(raw.flash_path ?? ""),
    inkColor: { r: Number(ink.r ?? 0), g: Number(ink.g ?? 0), b: Number(ink.b ?? 0) },
    enableNewScreen: Boolean(raw.enable_new_screen),
    isSampleRom: Boolean(raw.is_sample_rom),
    legacyKo: Boolean(raw.legacy_ko),
    u16Mode: Boolean(raw.u16_mode),
    largeModel: Boolean(raw.large_model ?? raw.LARGE_model),
    ml620Mirroring: Boolean(raw.ml620_mirroring),
    screenWidth: Number(raw.screen_width ?? 0),
    screenHeight: Number(raw.screen_height ?? 0),
    screenScaleY: Number(raw.screen_scale_y ?? 1),
    sprites,
    statusSpriteIndexes,
    statusIndicators,
    buttons,
    extra: Object.fromEntries(
      Object.entries(asRecord(raw.extra) ?? {}).map(([key, value]) => [key, String(value)]),
    ),
    source: "json",
  };
}

function readSprite(reader: BinaryReader): SpriteInfo {
  return { src: reader.rect(), dest: reader.rect() };
}

function readRectPairs(map: Map<string, SpriteInfo>, reader: BinaryReader) {
  map.clear();
  const count = reader.u64();
  for (let i = 0; i < count; i += 1) {
    const name = reader.string();
    map.set(name, readSprite(reader));
  }
}

export function manifestFromConfigBin(bytes: Uint8Array): ModelManifest {
  const reader = new BinaryReader(bytes);
  const format = reader.string();
  const csrMask = reader.u16();
  const hardwareId = reader.u16() as HardwareId;
  if (!(hardwareId in HARDWARE_NAMES)) {
    throw new Error(`Unsupported hardware_id ${hardwareId}.`);
  }
  const realHardware = reader.bool();
  const pdValue = reader.u8();
  const buttons: ModelManifest["buttons"] = [];
  const buttonCount = reader.u64();
  for (let i = 0; i < buttonCount; i += 1) {
    buttons.push({
      id: "",
      rect: reader.rect(),
      kiko: reader.i32(),
      keyname: reader.string(),
    });
  }
  const sprites = new Map<string, SpriteInfo>();
  readRectPairs(sprites, reader);
  const inkColor = { r: reader.i32(), g: reader.i32(), b: reader.i32() };
  const interfacePath = reader.string();
  const modelName = reader.string();
  const romPath = reader.string();
  const flashPath = reader.string();
  const enableNewScreen = reader.bool();
  const isSampleRom = reader.bool();
  const legacyKo = reader.bool();
  const u16Mode = reader.bool();
  const largeModel = reader.bool();
  const ml620Mirroring = reader.bool();
  const extra = new Map<string, string>();
  const extraCount = reader.u64();
  for (let i = 0; i < extraCount; i += 1) extra.set(reader.string(), reader.string());
  const statusSpriteIndexes: Record<string, number> = {};
  if (reader.remaining > 0) {
    const statusCount = reader.u64();
    for (let i = 0; i < statusCount; i += 1) {
      statusSpriteIndexes[reader.string()] = reader.i32();
    }
    const buttonSvgShapes: string[] = [];
    const shapeCount = reader.u64();
    for (let i = 0; i < shapeCount; i += 1) buttonSvgShapes.push(reader.string());
    const buttonSvgDefs: string[] = [];
    const defsCount = reader.u64();
    for (let i = 0; i < defsCount; i += 1) buttonSvgDefs.push(reader.string());
    buttons.forEach((button, index) => {
      button.svgShape = buttonSvgShapes[index] || undefined;
      button.svgDefs = buttonSvgDefs[index] || undefined;
    });
    const spriteSvgShapes = new Map<string, string>();
    const spriteShapeCount = reader.u64();
    for (let i = 0; i < spriteShapeCount; i += 1) {
      spriteSvgShapes.set(reader.string(), reader.string());
    }
    const spriteSvgDefs = new Map<string, string>();
    const spriteDefsCount = reader.u64();
    for (let i = 0; i < spriteDefsCount; i += 1) {
      spriteSvgDefs.set(reader.string(), reader.string());
    }
    for (const [name, sprite] of sprites) {
      sprite.svgShape = spriteSvgShapes.get(name);
      sprite.svgDefs = spriteSvgDefs.get(name);
    }
  }
  const boardPath = reader.remaining > 0 ? reader.string() : "";
  const screenWidth = reader.remaining > 0 ? reader.i32() : 0;
  const screenHeight = reader.remaining > 0 ? reader.i32() : 0;
  const screenScaleY = reader.remaining > 0 ? reader.f32() : 1;
  const statusIndicators = [];
  if (reader.remaining > 0) {
    const count = reader.u64();
    for (let i = 0; i < count; i += 1) {
      statusIndicators.push({ sprite: reader.string(), byte: reader.u16(), bit: reader.u8() });
    }
  }
  return {
    format,
    version: format.includes("v53") ? 53 : undefined,
    modelName,
    hardwareId,
    csrMask,
    realHardware,
    pdValue,
    interfacePath,
    boardPath,
    romPath,
    flashPath,
    inkColor,
    enableNewScreen,
    isSampleRom,
    legacyKo,
    u16Mode,
    largeModel,
    ml620Mirroring,
    screenWidth,
    screenHeight,
    screenScaleY,
    sprites: Object.fromEntries(sprites),
    statusSpriteIndexes,
    statusIndicators,
    buttons: buttons.map((button) => ({ ...button, id: `kiko-${button.kiko}` })),
    extra: Object.fromEntries(extra),
    source: "bin",
  };
}

function validateManifest(
  manifest: ModelManifest,
  files: ModelFile[],
  issues: ModelValidationIssue[],
) {
  const paths = new Set(files.map((file) => file.path));
  const requireFile = (path: string, label: string) => {
    if (!path) {
      issues.push({ path: "", severity: "error", message: `${label} path is empty.` });
    } else if (validateModelPath(path)) {
      issues.push({ path, severity: "error", message: `${label} uses an unsafe path.` });
    } else if (!paths.has(path)) {
      issues.push({
        path,
        severity: "error",
        message: `${label} was not found in the imported files.`,
      });
    }
  };
  requireFile(manifest.romPath, "ROM");
  requireFile(manifest.interfacePath, "Interface");
  if (manifest.flashPath) requireFile(manifest.flashPath, "Flash");
  if (manifest.boardPath) requireFile(manifest.boardPath, "Board");
  if (!manifest.buttons.length) {
    issues.push({ path: "", severity: "warning", message: "The model does not define any buttons." });
  }
  if (!manifest.interfacePath.toLowerCase().endsWith(".svg")) {
    issues.push({
      path: manifest.interfacePath,
      severity: "warning",
      message: "The interface is not SVG; bitmap skin rendering may fall back to the manifest.",
    });
  }
  const byteErrors = manifest.buttons.filter((button) => button.kiko < 0 || button.kiko > 255);
  if (byteErrors.length) {
    issues.push({
      path: "",
      severity: "error",
      message: `${byteErrors.length} button(s) have kiko codes outside 0..255.`,
    });
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export async function prepareModelImport(source: ImportSource): Promise<ImportPreview> {
  const issues: ModelValidationIssue[] = [];
  const sanitized = sanitizeModelFiles(source.files);
  issues.push(...sanitized.issues);
  const root = findModelRoot(sanitized.files);
  const files = stripModelRoot(sanitized.files, root);
  const hasTopLevelConfig = files.some(
    (file) =>
      !file.path.includes("/") &&
      (file.path === "config.json" || file.path === "config.bin"),
  );
  const normalizedNested = hasTopLevelConfig ? files : stripModelRoot(files, findModelRoot(files));
  const config = findConfigFile(normalizedNested);
  if (!config) {
    issues.push({
      path: "config.json",
      severity: "error",
      message: "A config.json or config.bin file is required.",
    });
    throw new ImportError("The model does not contain config.json or config.bin.", issues);
  }
  let manifest: ModelManifest;
  try {
    if (config.path === "config.json") {
      const rawConfig = JSON.parse(new TextDecoder().decode(config.bytes)) as Record<
        string,
        unknown
      >;
      const rawBoardPath =
        typeof rawConfig.board_path === "string" ? rawConfig.board_path : "";
      const board =
        normalizedNested.find((file) => file.path === rawBoardPath) ??
        normalizedNested.find((file) => file.path.endsWith(".svg"));
      const boardText = board ? new TextDecoder().decode(board.bytes) : undefined;
      manifest = manifestFromConfigJson(config.bytes, boardText);
    } else {
      manifest = manifestFromConfigBin(config.bytes);
    }
  } catch (error) {
    issues.push({
      path: config.path,
      severity: "error",
      message: error instanceof Error ? error.message : "Could not decode the model configuration.",
    });
    throw new ImportError("The model configuration is invalid.", issues);
  }
  validateManifest(manifest, normalizedNested, issues);
  const rom = normalizedNested.find((file) => file.path === manifest.romPath);
  const JSONBoardPath =
    manifest.source === "json"
      ? String(
          (JSON.parse(new TextDecoder().decode(config.bytes)) as Record<string, unknown>)
            .board_path ?? "",
        )
      : "";
  const board =
    normalizedNested.find((file) => file.path === manifest.boardPath) ??
    normalizedNested.find((file) => file.path === JSONBoardPath);
  const interfaceFile = normalizedNested.find((file) => file.path === manifest.interfacePath);
  if (!interfaceFile) {
    issues.push({
      path: manifest.interfacePath,
      severity: "error",
      message: "The interface asset referenced by the config was not found.",
    });
  }
  if (normalizedNested.length === 0) {
    issues.push({
      path: "",
      severity: "error",
      message: "The model contains no usable files.",
    });
  }
  const romHash = rom ? await sha256(rom.bytes) : "";
  const now = Date.now();
  const id = `${slug(manifest.modelName) || "model"}-${romHash.slice(0, 12)}`;
  const record: ModelRecord = {
    id,
    name: manifest.modelName || source.sourceName || "Untitled model",
    hardwareId: manifest.hardwareId,
    hardwareName: HARDWARE_NAMES[manifest.hardwareId],
    source: manifest.source,
    importedAt: now,
    updatedAt: now,
    manifest,
    files: normalizedNested,
    bytes: normalizedNested.reduce((sum, file) => sum + file.bytes.byteLength, 0),
    romHash,
    gameBufferSupported: Boolean(manifest.extra.game_buffer || manifest.extra.gamebuffer),
    boardSvg: board ? new TextDecoder().decode(board.bytes) : undefined,
    interfaceSvg:
      interfaceFile?.type === "image/svg+xml"
        ? new TextDecoder().decode(interfaceFile.bytes)
        : undefined,
    interfaceUrl:
      interfaceFile && interfaceFile.type !== "image/svg+xml"
        ? URL.createObjectURL(new Blob([interfaceFile.bytes as BufferSource], { type: interfaceFile.type }))
        : undefined,
  };
  if (issues.some((issue) => issue.severity === "error")) {
    if (record.interfaceUrl) URL.revokeObjectURL(record.interfaceUrl);
    throw new ImportError("The model did not pass validation.", issues);
  }
  return { manifest, files, issues, record };
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly issues: ModelValidationIssue[],
  ) {
    super(message);
    this.name = "ImportError";
  }
}

