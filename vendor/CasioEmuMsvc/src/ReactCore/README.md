# React core integration

This directory contains the browser-only build target for CasioEmuWeb.

`casioemu_react_api.cpp` is the stable C ABI used by the TypeScript bridge. It
uses the upstream headless `Emulator` implementation and keeps imported model
files in a `MemoryModelResourceStore`; no files are written to a virtual
filesystem and no ROM is embedded in the application.

The target deliberately omits the ImGui debugger, startup UI, plugins, audio,
Discord integration, recording, and worker threads. The React application owns
the debugger and calculator presentation.
