import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { deserializeModelFiles, serializeModelFiles } from "./import";
import type { KeyBindingOverrides } from "./keyBindings";
import type { ModelRecord, SnapshotNode, StoredModelRecord } from "./types";

const DB_NAME = "casio-emu-web";
const DB_VERSION = 1;

interface PersistentState {
  modelId: string;
  bytes: Uint8Array;
  updatedAt: number;
}

interface StoredSnapshot {
  id: string;
  modelId: string;
  node: SnapshotNode;
}

interface Setting {
  key: string;
  value: unknown;
}

interface CasioEmuDB extends DBSchema {
  models: {
    key: string;
    value: StoredModelRecord;
  };
  persistent: {
    key: string;
    value: PersistentState;
  };
  snapshots: {
    key: string;
    value: StoredSnapshot;
    indexes: { "by-model": string; "by-created": number };
  };
  settings: {
    key: string;
    value: Setting;
  };
}

let databasePromise: Promise<IDBPDatabase<CasioEmuDB>> | null = null;

function database() {
  if (!databasePromise) {
    databasePromise = openDB<CasioEmuDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("models")) {
          db.createObjectStore("models");
        }
        if (!db.objectStoreNames.contains("persistent")) {
          db.createObjectStore("persistent");
        }
        if (!db.objectStoreNames.contains("snapshots")) {
          const store = db.createObjectStore("snapshots");
          store.createIndex("by-model", "modelId");
          store.createIndex("by-created", "node.createdAt");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings");
        }
      },
      blocked() {
        console.warn("Another Casio Emu Web tab is holding an older database version.");
      },
    });
  }
  return databasePromise;
}

export async function listModels(): Promise<ModelRecord[]> {
  const db = await database();
  const values = await db.getAll("models");
  return values.map(inflateModel).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getModel(id: string): Promise<ModelRecord | undefined> {
  const db = await database();
  const value = await db.get("models", id);
  return value ? inflateModel(value) : undefined;
}

export async function saveModel(record: ModelRecord): Promise<void> {
  const db = await database();
  const { files, interfaceUrl: _interfaceUrl, ...recordWithoutFiles } = record;
  await db.put(
    "models",
    {
      record: recordWithoutFiles,
      files: serializeModelFiles(files),
      fileTypes: Object.fromEntries(files.map((file) => [file.path, file.type])),
    },
    record.id,
  );
}

export async function deleteModel(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["models", "persistent", "snapshots"], "readwrite");
  await tx.objectStore("models").delete(id);
  await tx.objectStore("persistent").delete(id);
  const snapshots = await tx.objectStore("snapshots").index("by-model").getAllKeys(id);
  for (const key of snapshots) await tx.objectStore("snapshots").delete(key);
  await tx.done;
}

export async function getPersistentState(id: string): Promise<Uint8Array | undefined> {
  const db = await database();
  return (await db.get("persistent", id))?.bytes;
}

export async function savePersistentState(id: string, bytes: Uint8Array): Promise<void> {
  const db = await database();
  await db.put("persistent", { modelId: id, bytes, updatedAt: Date.now() }, id);
}

export async function deletePersistentState(id: string): Promise<void> {
  const db = await database();
  await db.delete("persistent", id);
}

export async function listSnapshots(modelId: string): Promise<SnapshotNode[]> {
  const db = await database();
  const values = await db.getAllFromIndex("snapshots", "by-model", modelId);
  return values.map((item) => item.node).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveSnapshot(modelId: string, node: SnapshotNode): Promise<void> {
  const db = await database();
  const key = `${modelId}:${node.id}`;
  await db.put("snapshots", { id: key, modelId, node }, key);
}

export async function deleteSnapshot(modelId: string, id: string): Promise<void> {
  const db = await database();
  await db.delete("snapshots", `${modelId}:${id}`);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await database();
  return ((await db.get("settings", key))?.value as T | undefined) ?? fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await database();
  await db.put("settings", { key, value }, key);
}

function keyBindingSetting(modelId: string) {
  return `keyBindings:${modelId}`;
}

export async function getKeyBindingOverrides(
  modelId: string,
): Promise<KeyBindingOverrides> {
  const value = await getSetting<KeyBindingOverrides>(keyBindingSetting(modelId), {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | null] =>
        typeof entry[1] === "string" || entry[1] === null,
    ),
  );
}

export async function saveKeyBindingOverrides(
  modelId: string,
  overrides: KeyBindingOverrides,
): Promise<void> {
  await setSetting(keyBindingSetting(modelId), overrides);
}

export async function clearAllData(): Promise<void> {
  const db = await database();
  const tx = db.transaction(["models", "persistent", "snapshots", "settings"], "readwrite");
  await Promise.all([
    tx.objectStore("models").clear(),
    tx.objectStore("persistent").clear(),
    tx.objectStore("snapshots").clear(),
    tx.objectStore("settings").clear(),
  ]);
  await tx.done;
}

function inflateModel(value: StoredModelRecord): ModelRecord {
  const files = deserializeModelFiles(value.files, value.fileTypes);
  const interfaceFile = files.find((file) => file.path === value.record.manifest.interfacePath);
  const interfaceUrl =
    interfaceFile && interfaceFile.type !== "image/svg+xml"
      ? URL.createObjectURL(
          new Blob([interfaceFile.bytes as BlobPart], { type: interfaceFile.type }),
        )
      : undefined;
  return { ...value.record, files, interfaceUrl };
}
