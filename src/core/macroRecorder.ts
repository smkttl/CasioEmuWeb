import {
  MAX_RECORDED_EVENTS,
  MAX_RECORDING_DURATION_MS,
  type MacroKeyEvent,
  type MacroRecording,
} from "./macros";

export class MacroRecorder {
  private recording: MacroRecording | null = null;

  get active() {
    return this.recording !== null;
  }

  start(now = performance.now()) {
    this.recording = { startedAt: now, events: [] };
  }

  record(
    kiko: number,
    label: string,
    pressed: boolean,
    now = performance.now(),
  ): MacroKeyEvent | null {
    const recording = this.recording;
    if (!recording) return null;
    const atMs = Math.max(0, now - recording.startedAt);
    if (atMs > MAX_RECORDING_DURATION_MS) {
      throw new Error("The recording exceeded the 24-hour limit.");
    }
    if (recording.events.length >= MAX_RECORDED_EVENTS) {
      throw new Error(`The recording exceeded ${MAX_RECORDED_EVENTS} key events.`);
    }
    const last = recording.events.at(-1);
    if (
      last &&
      last.kiko === kiko &&
      last.pressed === pressed &&
      last.atMs === atMs
    ) {
      return null;
    }
    const event: MacroKeyEvent = {
      kiko,
      label: label.trim().slice(0, 80) || `Key ${kiko}`,
      pressed,
      atMs,
    };
    recording.events.push(event);
    return event;
  }

  stop() {
    const recording = this.recording;
    this.recording = null;
    return recording;
  }

  cancel() {
    this.recording = null;
  }
}
