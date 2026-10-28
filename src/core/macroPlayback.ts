import {
  replayDelayMs,
  type KeyMacro,
  type MacroReplaySpeed,
} from "./macros";

interface MacroPlaybackOptions {
  macro: KeyMacro;
  speed: MacroReplaySpeed;
  press: (kiko: number, pressed: boolean) => void;
  releaseAll: () => void;
  onProgress: (elapsedMs: number) => void;
  onComplete: () => void;
  onError: (error: unknown) => void;
}

export class MacroPlayback {
  private timer: number | null = null;
  private cancelled = false;
  private completed = false;

  constructor(private readonly options: MacroPlaybackOptions) {}

  start() {
    this.completed = false;
    this.cancelled = false;
    this.scheduleNext(0, 0);
  }

  cancel() {
    if (this.cancelled || this.completed) return;
    this.cancelled = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    try {
      this.options.releaseAll();
    } catch (error) {
      this.options.onError(error);
    }
  }

  private scheduleNext(index: number, previousAtMs: number) {
    if (this.cancelled || this.completed) return;
    const event = this.options.macro.events[index];
    if (!event) {
      this.completed = true;
      this.options.releaseAll();
      this.options.onProgress(this.options.macro.durationMs);
      this.options.onComplete();
      return;
    }
    const delay = replayDelayMs(event, previousAtMs, this.options.speed);
    this.timer = window.setTimeout(() => {
      if (this.cancelled) return;
      try {
        this.options.press(event.kiko, event.pressed);
        this.options.onProgress(event.atMs);
        this.scheduleNext(index + 1, event.atMs);
      } catch (error) {
        this.cancelled = true;
        this.options.releaseAll();
        this.options.onError(error);
      }
    }, delay);
  }
}
