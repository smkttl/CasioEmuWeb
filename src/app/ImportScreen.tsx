import { useRef, useState, type DragEvent } from "react";
import { FolderOpen, ShieldCheck, Upload, FileArchive, Cpu, LockKeyhole } from "lucide-react";
import type { ImportPreview, ModelRecord } from "../core/types";
import { ImportError } from "../core/import";
import { importDroppedFiles, importPickerFiles, importZip } from "./importFiles";

interface ImportScreenProps {
  models: ModelRecord[];
  onImported: (preview: ImportPreview) => void;
  onSelect: (record: ModelRecord) => void;
  onDelete: (record: ModelRecord) => void;
}

function errorDetails(error: unknown) {
  if (error instanceof ImportError) {
    return {
      message: error.message,
      issues: error.issues,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    issues: [],
  };
}

export function ImportScreen({ models, onImported, onSelect, onDelete }: ImportScreenProps) {
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorDetails> | null>(null);

  const runImport = async (task: () => Promise<ImportPreview>) => {
    setBusy(true);
    setError(null);
    try {
      onImported(await task());
    } catch (cause) {
      setError(errorDetails(cause));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length) void runImport(() => importDroppedFiles(files));
  };

  return (
    <main className="landing">
      <header className="landing-header">
        <div className="brand-stack">
          <span className="eyebrow">WEB ASSEMBLY · LOCAL ONLY</span>
          <h1>
            Casio<span>Emu</span>
          </h1>
        </div>
        <div className="header-note">
          <LockKeyhole size={15} />
          <span>Files never leave this browser</span>
        </div>
      </header>

      <section className="landing-grid">
        <div className="intro-panel">
          <p className="kicker">A focused emulator workbench</p>
          <h2>Run the machine.<br />Inspect every byte.</h2>
          <p className="lede">
            A frontend-only port of CasioEmuMsvc with a living calculator and a
            debugger side by side. Bring your own lawful model folder or ZIP.
          </p>
          <div className="principles">
            <div>
              <Cpu size={18} />
              <span>Native WASM core</span>
            </div>
            <div>
              <ShieldCheck size={18} />
              <span>No ROMs bundled</span>
            </div>
            <div>
              <LockKeyhole size={18} />
              <span>IndexedDB storage</span>
            </div>
          </div>
        </div>

        <div
          className={`drop-zone ${dragging ? "is-dragging" : ""} ${busy ? "is-busy" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="drop-index">01 / IMPORT</span>
          <div className="drop-icon">{busy ? <span className="spinner" /> : <Upload size={28} />}</div>
          <h3>{busy ? "Reading model…" : "Drop a model folder or ZIP"}</h3>
          <p>
            The folder must contain <code>config.json</code> or <code>config.bin</code>,
            its ROM, and the interface assets referenced by the config.
          </p>
          <div className="import-actions">
            <button disabled={busy} onClick={() => folderRef.current?.click()}>
              <FolderOpen size={17} /> Choose folder
            </button>
            <button disabled={busy} onClick={() => zipRef.current?.click()}>
              <FileArchive size={17} /> Choose ZIP
            </button>
          </div>
          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-expect-error non-standard but supported by Chromium/WebKit.
            webkitdirectory=""
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length) void runImport(() => importPickerFiles(files));
            }}
          />
          <input
            ref={zipRef}
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void runImport(() => importZip(file));
            }}
          />
          <small>Limits: 160 MB extracted, 4,096 files, no symlinks or encrypted ZIPs.</small>
        </div>
      </section>

      {error ? (
        <section className="import-error" role="alert">
          <strong>{error.message}</strong>
          {error.issues.length ? (
            <ul>
              {error.issues.slice(0, 8).map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  {issue.path ? <code>{issue.path}</code> : null} {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            ROMs and calculator skins are not distributed with this app. Use model
            files you are legally entitled to use.
          </p>
        </section>
      ) : null}

      <section className="library">
        <div className="section-heading">
          <div>
            <span className="drop-index">02 / LIBRARY</span>
            <h2>Local models</h2>
          </div>
          <span>{models.length} saved</span>
        </div>
        {models.length ? (
          <div className="model-list">
            {models.map((model) => (
              <article key={model.id} className="model-card">
                <div className="model-card-main">
                  <span className="model-badge">{model.hardwareName}</span>
                  <h3>{model.name}</h3>
                  <p>
                    {model.source.toUpperCase()} · {(model.bytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                    {model.manifest.buttons.length} keys
                  </p>
                  <code>{model.romHash.slice(0, 16) || "no ROM hash"}</code>
                </div>
                <div className="model-card-actions">
                  <button onClick={() => onSelect(model)}>Open calculator</button>
                  <button className="quiet danger-text" onClick={() => onDelete(model)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-library">
            No models saved yet. Imports are validated on this device and stored in
            IndexedDB for quick access.
          </p>
        )}
      </section>

      <footer className="landing-footer">
        <span>Based on CasioEmuMsvc · GPL-3.0</span>
        <span>No backend · No uploads · No embedded ROMs</span>
      </footer>
    </main>
  );
}
