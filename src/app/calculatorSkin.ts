import type { ModelRecord } from "../core/types";
import type { CalculatorSkin } from "./calculatorModel";

const SVG_DATA_PREFIX = "data:image/svg+xml;charset=utf-8,";

export function svgDataUrl(svg: string): string {
  return `${SVG_DATA_PREFIX}${encodeURIComponent(svg)}`;
}

export function iframeDocument(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
    svg{width:100%;height:100%;display:block}
  </style></head><body>${svg}</body></html>`;
}

export function canUseBoardImage(record: ModelRecord) {
  return Boolean(record.boardSvg || record.interfaceSvg);
}

export function calculatorGeometry(skin: CalculatorSkin, viewportWidth: number) {
  const scale = Math.min(1, viewportWidth / Math.max(1, skin.width));
  return {
    width: Math.round(skin.width * scale),
    height: Math.round(skin.height * scale),
    scale,
  };
}
