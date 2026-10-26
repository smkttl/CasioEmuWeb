import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelRecord } from "../core/types";
import { CalculatorStage } from "./CalculatorStage";
import type { CalculatorSkin } from "./calculatorModel";

afterEach(cleanup);

const record = {
  id: "test",
  name: "Test",
  hardwareName: "Test hardware",
  manifest: {
    inkColor: { r: 0, g: 0, b: 0 },
    statusIndicators: [],
    statusSpriteIndexes: {},
    sprites: {},
    buttons: [
      {
        id: "one",
        kiko: 0x11,
        keyname: "Digit1",
        rect: { x: 10, y: 10, w: 20, h: 20 },
      },
      {
        id: "two",
        kiko: 0x12,
        keyname: "Digit2",
        rect: { x: 40, y: 10, w: 20, h: 20 },
      },
    ],
  },
} as unknown as ModelRecord;

const skin: CalculatorSkin = {
  width: 100,
  height: 100,
  screen: { x: 5, y: 5, w: 40, h: 20 },
  interface: { x: 0, y: 0, w: 100, h: 100 },
  buttons: [
    { id: "one", kiko: 0x11, label: "1", rect: { x: 10, y: 10, w: 20, h: 20 } },
    { id: "two", kiko: 0x12, label: "2", rect: { x: 40, y: 10, w: 20, h: 20 } },
  ],
};

function renderStage(overrides: Record<string, string | null> = {}) {
  const onPress = vi.fn();
  const onSet = vi.fn().mockResolvedValue(undefined);
  const onReset = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <CalculatorStage
      record={record}
      skin={skin}
      frame={null}
      running={false}
      coreReady
      status="Paused"
      onRun={() => undefined}
      onPause={() => undefined}
      onReset={() => undefined}
      onPress={onPress}
      onReleaseAll={() => undefined}
      keyBindings={overrides}
      onSetKeyBinding={onSet}
      onResetKeyBinding={onReset}
    />,
  );
  return { ...view, onPress, onSet, onReset };
}

describe("CalculatorStage key binding editor", () => {
  it("opens from right-click without pressing the calculator key", () => {
    const { onPress } = renderStage();
    const key = screen.getByRole("button", { name: "1 (1)" });
    fireEvent.pointerDown(key, { button: 2, clientX: 10, clientY: 10 });
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.contextMenu(key, { clientX: 40, clientY: 40 });
    expect(screen.getByRole("dialog", { name: "Key binding for 1" })).toBeInTheDocument();
  });

  it("warns before replacing a key and can cancel", () => {
    const { onSet } = renderStage();
    const key = screen.getByRole("button", { name: "1 (1)" });
    fireEvent.contextMenu(key, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("button", { name: "Change key" }));
    fireEvent.keyDown(window, { code: "Digit2" });
    expect(screen.getByRole("alert")).toHaveTextContent("2 is already bound");
    expect(onSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSet).not.toHaveBeenCalled();
  });

  it("replaces a conflicting binding after confirmation", () => {
    const { onSet } = renderStage();
    const key = screen.getByRole("button", { name: "1 (1)" });
    fireEvent.contextMenu(key, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("button", { name: "Change key" }));
    fireEvent.keyDown(window, { code: "Digit2" });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), "Digit2");
  });

  it("rejects reserved debugger shortcuts", () => {
    const { onSet } = renderStage();
    const key = screen.getByRole("button", { name: "1 (1)" });
    fireEvent.contextMenu(key, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("button", { name: "Change key" }));
    fireEvent.keyDown(window, { code: "F5" });
    expect(screen.getByText("F5 is reserved by the debugger.")).toBeInTheDocument();
    expect(onSet).not.toHaveBeenCalled();
  });

  it("binds an available key and closes the editor", async () => {
    const { onSet } = renderStage();
    const key = screen.getByRole("button", { name: "1 (1)" });
    fireEvent.contextMenu(key, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("button", { name: "Change key" }));
    fireEvent.keyDown(window, { code: "KeyQ" });
    expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), "KeyQ");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("resets to the imported default", () => {
    const { onReset } = renderStage({ one: "KeyQ" });
    const key = screen.getByRole("button", { name: "1 (Q)" });
    fireEvent.contextMenu(key, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(onReset).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });
});
