# Casio Emu Web

A local-first, frontend-only web workbench for CasioEmuMsvc. The calculator
and debugger share a native WebAssembly core ported from
[CasioEmuMsvc](https://github.com/telecomadm1145/CasioEmuMsvc).

The app does not include, download, or fetch calculator ROMs. Import only model
files and firmware that you are legally entitled to use.

## Features

- Desktop layout with the calculator and debugger side by side.
- Mobile layout with the calculator first and the debugger in a bottom sheet.
- `config.json` and `config.bin` model imports from a folder or ZIP.
- Registers, disassembly, breakpoints, memory inspection/editing, call stack,
  snapshots, and persistent battery-backed RAM.
- SVG board, SVG interface, and bitmap interface skins.
- Model files, RAM, and snapshots stored locally in IndexedDB.
- No backend, ROM bundle, pthreads, `SharedArrayBuffer`, or cross-origin
  isolation headers.

## Development

Requirements:

- Node.js 20 or newer
- An Emscripten SDK for building the WebAssembly core

Install dependencies and start Vite:

```bash
npm install
npm run dev
```

The UI can start without a built core, but loading a calculator requires
`public/core/casioemu-core.js` and `public/core/casioemu-core.wasm`.
Both files are generated locally and ignored by Git; CI rebuilds them from the
vendored source before deployment.

### Build the WebAssembly core

Activate an Emscripten SDK, then expose its source, LLVM, and Binaryen roots:

```bash
export EMSCRIPTEN_ROOT=/path/to/emsdk/upstream/emscripten
export EM_LLVM_ROOT=/path/to/emsdk/upstream/bin
export EM_BINARYEN_ROOT=/path/to/emsdk/upstream
npm run core:build
```

The build writes both artifacts to `public/core/`. They are intentionally not
committed because they are generated from the vendored upstream source. The
Pages workflow installs Emscripten and rebuilds them before deploying.

### Verification

```bash
npm run typecheck
npm test
npm run core:build
npm run build
```

`npm run build` refuses to produce a deployment bundle unless both WebAssembly
artifacts are present, so CI cannot publish a dashboard without its core.

## Importing a model

Choose a model folder or ZIP containing:

- `config.json` or `config.bin`
- The ROM referenced by `rom_path`
- The interface referenced by `interface_path`
- The board SVG referenced by `board_path`, when present
- The flash image referenced by `flash_path`, when present

The importer strips one enclosing archive directory, normalizes paths, rejects
path traversal, case-insensitive collisions, symlinks, encrypted ZIP entries,
oversized archives, and unsupported hardware IDs. Imported files remain in the
browser and are not uploaded.

## Debug shortcuts

| Key | Action |
| --- | --- |
| `F5` | Run |
| `F8` | Pause |
| `F9` | Toggle a breakpoint at the current PC |
| `F10` | Step over |
| `F11` | Step into |

## Keyboard bindings

Right-click a printed calculator key (or long-press it on a touch device) to
change its physical-key binding. Bindings are stored locally per model and
can be reset to the imported model's default. If a key is already assigned to
another button, the editor warns you and offers Cancel or Replace; replacing
moves that key to the selected button. Modifier-only keys and the debugger
shortcuts above cannot be bound. Modifier chords are distinct bindings: for
example, `Shift+9` does not conflict with `9`, and `Ctrl`, `Alt`, and `Meta`
combinations are tracked independently.

## Architecture

- `src/core/` parses models and ZIPs, persists local state, and exposes the
  WebAssembly C ABI to TypeScript.
- `src/app/` contains the calculator stage, debugger, import flow, and session
  state.
- `vendor/CasioEmuMsvc/` is the vendored upstream source plus the React headless
  bridge and rendering stubs.
- `scripts/build-core.sh` compiles the bridge with Emscripten.

## Licensing

CasioEmuWeb is licensed under GPL-3.0-or-later. CasioEmuMsvc remains subject to
its own license and attribution requirements; see
`vendor/CasioEmuMsvc/LICENSE`.
