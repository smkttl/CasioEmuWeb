import type {
  CoreModelInfo,
  ModelManifest,
  ModelRecord,
  Rect,
  SpriteInfo,
} from "../core/types";

export interface CalculatorSkin {
  width: number;
  height: number;
  screen: Rect;
  interface: Rect;
  buttons: Array<{
    id: string;
    label: string;
    kiko: number;
    rect: Rect;
  }>;
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function rectWidth(rect: Rect | undefined) {
  return rect ? positive(rect.w, 1) : 1;
}

function rectHeight(rect: Rect | undefined) {
  return rect ? positive(rect.h, 1) : 1;
}

function normalizeRect(rect: Rect | undefined): Rect {
  return {
    x: Number(rect?.x ?? 0),
    y: Number(rect?.y ?? 0),
    w: positive(Number(rect?.w ?? 0), 1),
    h: positive(Number(rect?.h ?? 0), 1),
  };
}

export function screenRectFor(manifest: ModelManifest): Rect {
  const screen = manifest.sprites.rsd_pixel;
  if (screen) return normalizeRect(screen.dest);
  const board = manifest.boardPath ? manifest.sprites.rsd_interface : undefined;
  const width = positive(manifest.screenWidth, 320);
  const height = positive(manifest.screenHeight, 160);
  const interfaceRect = board ? normalizeRect(board.dest) : { x: 0, y: 0, w: 400, h: 600 };
  return {
    x: Math.round(interfaceRect.w * 0.12),
    y: Math.round(interfaceRect.h * 0.12),
    w: width,
    h: height,
  };
}

export function interfaceRectFor(manifest: ModelManifest): Rect {
  const sprite = manifest.sprites.rsd_interface;
  if (sprite) return normalizeRect(sprite.dest);
  const screen = screenRectFor(manifest);
  return {
    x: 0,
    y: 0,
    w: Math.max(screen.x + screen.w + screen.x, 400),
    h: Math.max(screen.y + screen.h + Math.max(140, screen.y), 600),
  };
}

export function skinFor(record: ModelRecord): CalculatorSkin {
  const manifest = record.manifest;
  const interfaceRect = interfaceRectFor(manifest);
  const screen = screenRectFor(manifest);
  const buttons = manifest.buttons.map((button, index) => ({
    id: button.id || `${button.kiko}-${index}`,
    label: button.keyname || `Key ${button.kiko}`,
    kiko: button.kiko,
    rect: normalizeRect(button.rect),
  }));
  return {
    width: Math.max(interfaceRect.x + interfaceRect.w, screen.x + screen.w, 1),
    height: Math.max(interfaceRect.y + interfaceRect.h, screen.y + screen.h, 1),
    screen,
    interface: interfaceRect,
    buttons,
  };
}

export function spriteAspect(sprite: SpriteInfo | undefined, fallback: number) {
  if (!sprite) return fallback;
  const width = rectWidth(sprite.src);
  const height = rectHeight(sprite.src);
  return height > 0 ? width / height : fallback;
}

export function calculateDisplayAspect(manifest: ModelManifest) {
  return spriteAspect(manifest.sprites.rsd_pixel, 3 / 2);
}

export function applyCoreModelInfo(
  record: ModelRecord,
  info: CoreModelInfo | null,
): ModelRecord {
  if (!info) return record;
  const manifest: ModelManifest = {
    ...record.manifest,
    ...(info.modelName ? { modelName: info.modelName } : {}),
    ...(info.hardwareId !== undefined ? { hardwareId: info.hardwareId } : {}),
    ...(info.csrMask !== undefined ? { csrMask: info.csrMask } : {}),
    ...(info.realHardware !== undefined ? { realHardware: info.realHardware } : {}),
    ...(info.pdValue !== undefined ? { pdValue: info.pdValue } : {}),
    ...(info.interfacePath ? { interfacePath: info.interfacePath } : {}),
    ...(info.boardPath !== undefined ? { boardPath: info.boardPath } : {}),
    ...(info.romPath ? { romPath: info.romPath } : {}),
    ...(info.flashPath !== undefined ? { flashPath: info.flashPath } : {}),
    ...(info.inkColor ? { inkColor: info.inkColor } : {}),
    ...(info.enableNewScreen !== undefined
      ? { enableNewScreen: info.enableNewScreen }
      : {}),
    ...(info.isSampleRom !== undefined ? { isSampleRom: info.isSampleRom } : {}),
    ...(info.legacyKo !== undefined ? { legacyKo: info.legacyKo } : {}),
    ...(info.u16Mode !== undefined ? { u16Mode: info.u16Mode } : {}),
    ...(info.largeModel !== undefined ? { largeModel: info.largeModel } : {}),
    ...(info.ml620Mirroring !== undefined
      ? { ml620Mirroring: info.ml620Mirroring }
      : {}),
    ...(info.screenWidth !== undefined ? { screenWidth: info.screenWidth } : {}),
    ...(info.screenHeight !== undefined ? { screenHeight: info.screenHeight } : {}),
    ...(info.screenScaleY !== undefined ? { screenScaleY: info.screenScaleY } : {}),
    ...(info.sprites ? { sprites: info.sprites } : {}),
    ...(info.statusSpriteIndexes
      ? { statusSpriteIndexes: info.statusSpriteIndexes }
      : {}),
    ...(info.statusIndicators ? { statusIndicators: info.statusIndicators } : {}),
    ...(info.buttons?.length ? { buttons: info.buttons } : {}),
    ...(info.extra ? { extra: info.extra } : {}),
  };
  return {
    ...record,
    name: info.modelName || record.name,
    hardwareId: info.hardwareId ?? record.hardwareId,
    hardwareName: info.hardwareName || record.hardwareName,
    manifest,
  };
}
