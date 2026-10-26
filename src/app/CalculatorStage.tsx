import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { FrameState, ModelRecord } from "../core/types";
import type { CalculatorSkin } from "./calculatorModel";
import { iframeDocument } from "./calculatorSkin";

interface CalculatorStageProps {
  record: ModelRecord;
  skin: CalculatorSkin;
  frame: FrameState | null;
  running: boolean;
  coreReady: boolean;
  status: string;
  onRun: () => void;
  onPause: () => void;
  onReset: () => void;
  onPress: (kiko: number, pressed: boolean) => void;
  onReleaseAll: () => void;
}

function drawScreen(canvas: HTMLCanvasElement, frame: FrameState | null) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  context.clearRect(0, 0, width, height);
  if (!frame || !frame.width || !frame.height || !frame.pixels.byteLength) return;
  const image = new ImageData(
    new Uint8ClampedArray(frame.pixels),
    frame.width,
    frame.height,
  );
  const offscreen = document.createElement("canvas");
  offscreen.width = frame.width;
  offscreen.height = frame.height;
  offscreen.getContext("2d")?.putImageData(image, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(offscreen, 0, 0, width, height);
}

function StatusOverlay({
  frame,
  record,
  screenRect,
  skinScale,
}: {
  frame: FrameState | null;
  record: ModelRecord;
  screenRect: CalculatorSkin["screen"];
  skinScale: number;
}) {
  const indicators = record.manifest.statusIndicators;
  if (!frame?.statusWidth || !indicators.length) return null;
  return (
    <div
      className="status-indicators"
      style={{
        left: screenRect.x * skinScale,
        top: screenRect.y * skinScale,
        width: screenRect.w * skinScale,
        height: Math.max(10, screenRect.h * skinScale * 0.18),
      }}
    >
      {indicators.map((indicator) => {
        const spriteIndex = record.manifest.statusSpriteIndexes[indicator.sprite];
        const alpha =
          spriteIndex !== undefined && frame.statusAlpha[spriteIndex]
            ? frame.statusAlpha[spriteIndex] / 255
            : 0;
        const sprite = record.manifest.sprites[indicator.sprite];
        return (
          <span
            key={indicator.sprite}
            className="status-indicator"
            title={indicator.sprite}
            style={{
              opacity: alpha,
              width: `${Math.max(18, (sprite?.dest.w ?? 18) * 0.5)}px`,
              height: `${Math.max(12, (sprite?.dest.h ?? 12) * 0.5)}px`,
            }}
          >
            {indicator.sprite.replace(/^rsd_/, "")}
          </span>
        );
      })}
    </div>
  );
}

export function CalculatorStage({
  record,
  skin,
  frame,
  running,
  coreReady,
  status,
  onRun,
  onPause,
  onReset,
  onPress,
  onReleaseAll,
}: CalculatorStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(560);
  const pressed = useRef(new Set<number>());
  const scale = useMemo(() => {
    const maxWidth = Math.max(230, wrapWidth - 28);
    const maxHeight = Math.max(260, window.innerHeight - 250);
    return Math.min(maxWidth / skin.width, maxHeight / skin.height, 1.08);
  }, [skin.height, skin.width, wrapWidth]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWrapWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const screenWidth = Math.max(40, Math.round(skin.screen.w * scale));
  const screenHeight = Math.max(24, Math.round(skin.screen.h * scale));

  useEffect(() => {
    if (canvasRef.current && frame) drawScreen(canvasRef.current, frame);
  }, [frame, screenHeight, screenWidth]);

  const boardSvg = record.boardSvg;
  const interfaceSvg = record.interfaceSvg;
  const renderedSvg = boardSvg || interfaceSvg;
  const renderedRect = boardSvg ? { x: 0, y: 0, w: skin.width, h: skin.height } : skin.interface;
  const renderedBitmap = !renderedSvg && record.interfaceUrl ? record.interfaceUrl : null;

  const releaseAt = (kiko: number) => {
    if (!pressed.current.has(kiko)) return;
    pressed.current.delete(kiko);
    onPress(kiko, false);
  };

  return (
    <section className="calculator-panel" aria-label="Calculator">
      <div className="calculator-toolbar">
        <div className="calculator-title">
          <span className="device-dot" />
          <div>
            <strong>{record.name}</strong>
            <small>{record.hardwareName}</small>
          </div>
        </div>
        <div className="calculator-controls">
          {running ? (
            <button onClick={onPause} title="Pause (F8)">
              <Pause size={16} /> Pause
            </button>
          ) : (
            <button className="run-button" onClick={onRun} disabled={!coreReady} title="Run (F5)">
              <Play size={16} /> Run
            </button>
          )}
          <button onClick={onReset} disabled={!coreReady} title="Reset (Ctrl+R)">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      <div className="calculator-stage" ref={wrapRef} onPointerLeave={onReleaseAll}>
        <div
          className="calculator-device"
          style={{
            width: Math.round(skin.width * scale),
            height: Math.round(skin.height * scale),
          }}
          onPointerUp={onReleaseAll}
        >
          {renderedSvg ? (
            <iframe
              className="skin-frame"
              title={`${record.name} skin`}
              sandbox=""
              srcDoc={iframeDocument(renderedSvg)}
              style={{
                left: renderedRect.x * scale,
                top: renderedRect.y * scale,
                width: renderedRect.w * scale,
                height: renderedRect.h * scale,
              }}
            />
          ) : renderedBitmap ? (
            <img
              className="skin-bitmap"
              src={renderedBitmap}
              alt=""
              draggable={false}
              style={{
                left: renderedRect.x * scale,
                top: renderedRect.y * scale,
                width: renderedRect.w * scale,
                height: renderedRect.h * scale,
              }}
            />
          ) : (
            <div className="fallback-skin" />
          )}
          <div
            className="lcd-frame"
            style={{
              left: skin.screen.x * scale - 5,
              top: skin.screen.y * scale - 5,
              width: screenWidth + 10,
              height: screenHeight + 10,
            }}
          >
            <canvas ref={canvasRef} width={screenWidth} height={screenHeight} />
            <div
              className="lcd-shine"
              style={{
                background: `rgba(${record.manifest.inkColor.r}, ${record.manifest.inkColor.g}, ${record.manifest.inkColor.b}, 0.055)`,
              }}
            />
          </div>
          <StatusOverlay
            frame={frame}
            record={record}
            screenRect={skin.screen}
            skinScale={scale}
          />
          {skin.buttons.map((button) => (
            <button
              key={`${button.id}-${button.kiko}`}
              className="key-hit"
              aria-label={button.label}
              title={`${button.label} · kiko ${button.kiko}`}
              style={{
                left: button.rect.x * scale,
                top: button.rect.y * scale,
                width: Math.max(8, button.rect.w * scale),
                height: Math.max(8, button.rect.h * scale),
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                pressed.current.add(button.kiko);
                onPress(button.kiko, true);
              }}
              onPointerUp={(event) => {
                event.preventDefault();
                releaseAt(button.kiko);
              }}
              onPointerCancel={() => releaseAt(button.kiko)}
              onContextMenu={(event) => event.preventDefault()}
            />
          ))}
          {!coreReady ? (
            <div className="device-overlay">
              <span className="device-status">{status}</span>
            </div>
          ) : null}
        </div>
        <div className="stage-caption">
          <span>Click or touch the printed keys</span>
          <span className="stage-scale">{Math.round(scale * 100)}%</span>
        </div>
      </div>
    </section>
  );
}
