import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllData,
  deletePersistentState,
  deleteSnapshot,
  getMacroStore,
  getPersistentState,
  listSnapshots,
  savePersistentState,
  saveMacroStore,
  saveSnapshot,
} from "./storage";
import type { KeyMacro } from "./macros";
import type { SnapshotNode } from "./types";

function snapshot(id: string, label: string, bytes: number[]): SnapshotNode {
  return {
    id,
    label,
    createdAt: Number(id.split("-")[0]),
    parentId: null,
    bytes: new Uint8Array(bytes),
  };
}

describe("snapshot storage", () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it("saves, lists, and deletes snapshots with binary state intact", async () => {
    const node = snapshot("1-first", "First", [0, 1, 127, 255]);

    await saveSnapshot("model-a", node);

    const snapshots = await listSnapshots("model-a");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      id: node.id,
      label: node.label,
      createdAt: node.createdAt,
      parentId: node.parentId,
    });
    expect(ArrayBuffer.isView(snapshots[0].bytes)).toBe(true);
    expect([...snapshots[0].bytes]).toEqual([0, 1, 127, 255]);

    await deleteSnapshot("model-a", node.id);
    expect(await listSnapshots("model-a")).toEqual([]);
  });

  it("keeps snapshots isolated by model and orders them by creation time", async () => {
    const later = snapshot("2-later", "Later", [2]);
    const earlier = snapshot("1-earlier", "Earlier", [1]);
    const other = snapshot("3-other", "Other model", [3]);

    await saveSnapshot("model-a", later);
    await saveSnapshot("model-a", earlier);
    await saveSnapshot("model-b", other);

    expect((await listSnapshots("model-a")).map((node) => node.id)).toEqual([
      "1-earlier",
      "2-later",
    ]);
    expect((await listSnapshots("model-b")).map((node) => node.id)).toEqual([
      "3-other",
    ]);
  });
});

describe("persistent RAM storage", () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it("round-trips persistent RAM bytes by model", async () => {
    await savePersistentState("model-a", new Uint8Array([0, 1, 127, 255]));

    expect([...(await getPersistentState("model-a"))!]).toEqual([0, 1, 127, 255]);
    expect(await getPersistentState("model-b")).toBeUndefined();

    await deletePersistentState("model-a");
    expect(await getPersistentState("model-a")).toBeUndefined();
  });
});

describe("macro storage", () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it("round-trips valid macros and replay speed by model", async () => {
    const macro: KeyMacro = {
      id: "macro-a",
      name: "Sequence",
      createdAt: 1,
      durationMs: 20,
      events: [
        { kiko: 1, label: "1", pressed: true, atMs: 0 },
        { kiko: 1, label: "1", pressed: false, atMs: 20 },
      ],
    };
    await saveMacroStore("model-a", { macros: [macro], replaySpeed: 2 });

    expect(await getMacroStore("model-a")).toEqual({
      macros: [macro],
      replaySpeed: 2,
    });
    expect(await getMacroStore("model-b")).toEqual({
      macros: [],
      replaySpeed: 1,
    });
  });
});
