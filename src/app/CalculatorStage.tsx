import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pause, Play, RotateCcw, X } from "lucide-react";
import {
  bindingOwner,
  buttonBinding,
  isModifierCode,
  isReservedKeyCode,
  keyChordFromEvent,
  keyBindingLabel,
  type BindingConflict,
  type KeyBindingOverrides,
} from "../core/keyBindings";
import type { FrameState, ModelButton, ModelRecord } from "../core/types";
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
  keyBindings: KeyBindingOverrides;
  onSetKeyBinding: (button: ModelButton, code: string) => Promise<void>;
  onResetKeyBinding: (button: ModelButton) => Promise<void>;
}

interface SkinButton extends ModelButton {
  label: string;
}

interface MenuConflict extends Omit<BindingConflict, "button"> {
  button: SkinButton;
}

interface MenuState {
  button: SkinButton;
  left: number;
  top: number;
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
  keyBindings,
  onSetKeyBinding,
  onResetKeyBinding,
}: CalculatorStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(560);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [conflict, setConflict] = useState<MenuConflict | null>(null);
  const pressed = useRef(new Set<number>());
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
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

  const closeMenu = () => {
    setMenu(null);
    setCapturing(false);
    setCaptureError("");
    setConflict(null);
  };

  useEffect(() => {
    if (!menu || capturing) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [capturing, menu]);

  useEffect(() => () => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
  }, []);

  const skinButtons = useMemo(
    () =>
      skin.buttons.map((button) => {
        const source = record.manifest.buttons.find(
          (candidate) => candidate.kiko === button.kiko,
        );
        return {
          id: button.id,
          kiko: button.kiko,
          keyname: source?.keyname ?? "",
          rect: button.rect,
          label: button.label,
        };
      }),
    [record.manifest.buttons, skin.buttons],
  );

  useEffect(() => {
    if (!capturing || !menu) return;
    const onCapture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.code === "Escape") {
        setCapturing(false);
        setCaptureError("");
        setConflict(null);
        return;
      }
      const code = keyChordFromEvent(event.code, event);
      if (!code) {
        if (!isModifierCode(event.code)) {
          setCaptureError("Press a non-modifier key.");
        }
        return;
      }
      if (isReservedKeyCode(code)) {
        setCaptureError(`${keyBindingLabel(code)} is reserved by the debugger.`);
        return;
      }
      const owner = bindingOwner(code, skinButtons, keyBindings, menu.button.id);
      if (owner) {
        setConflict({
          ...owner,
          button: {
            ...owner.button,
            label:
              skinButtons.find((button) => button.id === owner.button.id)?.label ??
              (owner.button.keyname || `Key ${owner.button.kiko}`),
          },
        });
        setCapturing(false);
        return;
      }
      void onSetKeyBinding(menu.button, code).then(() => closeMenu());
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  }, [capturing, keyBindings, menu, onSetKeyBinding, skinButtons]);

  const openMenu = (button: SkinButton, clientX: number, clientY: number) => {
    const stage = wrapRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    setMenu({
      button,
      left: Math.max(12, Math.min(clientX - bounds.left, bounds.width - 244)),
      top: Math.max(12, Math.min(clientY - bounds.top, bounds.height - 210)),
    });
    setCapturing(false);
    setCaptureError("");
    setConflict(null);
  };

  const startCapture = () => {
    setCapturing(true);
    setCaptureError("");
    setConflict(null);
  };

  const replaceConflict = async () => {
    if (!conflict || !menu) return;
    await onSetKeyBinding(menu.button, conflict.code);
    closeMenu();
  };

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
          {skinButtons.map((button) => {
            const binding = buttonBinding(button, keyBindings);
            return (
              <button
                key={`${button.id}-${button.kiko}`}
                className="key-hit"
                aria-label={`${button.label} (${keyBindingLabel(binding)})`}
                title={`${button.label} · ${keyBindingLabel(binding)} · kiko ${button.kiko}`}
                style={{
                  left: button.rect.x * scale,
                  top: button.rect.y * scale,
                  width: Math.max(8, button.rect.w * scale),
                  height: Math.max(8, button.rect.h * scale),
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  if (event.button !== 0) return;
                  if (event.pointerType === "touch") {
                    const touch = {
                      timer: window.setTimeout(() => {
                        openMenu(button, event.clientX, event.clientY);
                      }, 550),
                      x: event.clientX,
                      y: event.clientY,
                    };
                    longPress.current = touch;
                  }
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pressed.current.add(button.kiko);
                  onPress(button.kiko, true);
                }}
                onPointerMove={(event) => {
                  const touch = longPress.current;
                  if (!touch) return;
                  if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) {
                    window.clearTimeout(touch.timer);
                    longPress.current = null;
                  }
                }}
                onPointerUp={(event) => {
                  event.preventDefault();
                  const touch = longPress.current;
                  if (touch) {
                    window.clearTimeout(touch.timer);
                    longPress.current = null;
                  }
                  releaseAt(button.kiko);
                }}
                onPointerCancel={() => {
                  const touch = longPress.current;
                  if (touch) {
                    window.clearTimeout(touch.timer);
                    longPress.current = null;
                  }
                  releaseAt(button.kiko);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenu(button, event.clientX, event.clientY);
                }}
              />
            );
          })}
          {!coreReady ? (
            <div className="device-overlay">
              <span className="device-status">{status}</span>
            </div>
          ) : null}
          {menu ? (
            <div
              ref={menuRef}
              className="binding-menu"
              role="dialog"
              aria-label={`Key binding for ${menu.button.label}`}
              style={{ left: menu.left, top: menu.top }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="binding-menu-head">
                <div>
                  <span>Key binding</span>
                  <strong>{menu.button.label}</strong>
                </div>
                <button className="binding-close" onClick={closeMenu} aria-label="Close key binding menu">
                  <X size={13} />
                </button>
              </div>
              <p className="binding-current">
                Current <kbd>{keyBindingLabel(buttonBinding(menu.button, keyBindings))}</kbd>
              </p>
              <p className="binding-hint">
                Right-click a key to edit it. Debugger shortcuts stay reserved.
              </p>
              {capturing ? (
                <div className="binding-capture" role="status">
                  <span className="capture-dot" />
                  Press a key to bind…
                </div>
              ) : conflict ? (
                <div className="binding-conflict" role="alert">
                  <strong>{keyBindingLabel(conflict.code)} is already bound.</strong>
                  <span>It currently presses “{conflict.button.label}”.</span>
                </div>
              ) : (
                <button className="binding-action" onClick={startCapture}>
                  <Keyboard size={14} />
                  {buttonBinding(menu.button, keyBindings) ? "Change key" : "Bind key"}
                </button>
              )}
              {captureError ? <p className="binding-error">{captureError}</p> : null}
              {conflict ? (
                <div className="binding-buttons">
                  <button onClick={() => setConflict(null)}>Cancel</button>
                  <button className="binding-replace" onClick={() => void replaceConflict()}>
                    Replace
                  </button>
                </div>
              ) : (
                <button
                  className="binding-reset"
                  onClick={() => {
                    void onResetKeyBinding(menu.button).then(closeMenu);
                  }}
                  disabled={!buttonBinding(menu.button, keyBindings) && !menu.button.keyname}
                >
                  Reset to default
                </button>
              )}
            </div>
          ) : null}
        </div>
        <div className="stage-caption">
          <span>Click keys · Right-click or long-press to bind</span>
          <span className="stage-scale">{Math.round(scale * 100)}%</span>
        </div>
      </div>
    </section>
  );
}
