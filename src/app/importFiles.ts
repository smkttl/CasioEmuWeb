import { readModelArchive } from "../core/archive";
import {
  ImportError,
  prepareModelImport,
  sanitizeModelFiles,
} from "../core/import";
import type { ImportPreview, ModelFile } from "../core/types";

const MAX_SELECTED_FILES = 4096;
const MAX_SELECTED_BYTES = 160 * 1024 * 1024;

async function readBrowserFile(file: File, path: string): Promise<ModelFile> {
  return {
    path,
    bytes: new Uint8Array(await file.arrayBuffer()),
    type: file.type,
  };
}

export async function importPickerFiles(files: File[]): Promise<ImportPreview> {
  if (!files.length) throw new ImportError("No files were selected.", []);
  if (files.length > MAX_SELECTED_FILES) {
    throw new ImportError("Too many files were selected.", []);
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_SELECTED_BYTES) {
    throw new ImportError("The selected files are too large.", []);
  }

  const entries = files.map((file) => ({
    file,
    path: (file.webkitRelativePath || file.name).replaceAll("\\", "/"),
  }));
  if (
    !files.some((file) =>
      /(^|\/)config\.(json|bin)$/i.test(file.webkitRelativePath || file.name),
    )
  ) {
    throw new ImportError(
      "No config.json or config.bin was found. Choose the model folder or a model ZIP.",
      [],
    );
  }
  const sanitized = sanitizeModelFiles(
    entries.map(({ file, path }) => ({
      path,
      bytes: new Uint8Array(),
      type: file.type,
    })),
  );
  if (sanitized.issues.length) {
    throw new ImportError(sanitized.issues[0].message, sanitized.issues);
  }

  const modelFiles: ModelFile[] = [];
  for (const { file, path } of entries) {
    modelFiles.push(await readBrowserFile(file, path));
  }
  return prepareModelImport({ files: modelFiles, sourceName: entries[0]?.file.name });
}

export async function importZip(file: File): Promise<ImportPreview> {
  const source = await readModelArchive(file, file.name);
  return prepareModelImport(source);
}

export async function importDroppedFiles(files: File[]): Promise<ImportPreview> {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    return importZip(files[0]);
  }
  const withRelativePaths = files.map((file) => {
    if (!file.webkitRelativePath) {
      Object.defineProperty(file, "webkitRelativePath", {
        configurable: true,
        value: file.name,
      });
    }
    return file;
  });
  return importPickerFiles(withRelativePaths);
}

export function ignoreAbort(error: unknown): ImportPreview | null {
  if (error instanceof DOMException && error.name === "AbortError") return null;
  throw error;
}
