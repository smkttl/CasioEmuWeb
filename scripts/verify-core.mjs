import { access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "public/core/casioemu-core.js",
  "public/core/casioemu-core.wasm",
];

const missing = [];
for (const file of required) {
  try {
    await access(resolve(root, file));
  } catch {
    missing.push(file);
  }
}

if (missing.length) {
  console.error(
    [
      "The WebAssembly core has not been built.",
      ...missing.map((file) => `  missing ${file}`),
      "",
      "Run `npm run core:build` with Emscripten installed before `npm run build`.",
    ].join("\n"),
  );
  process.exit(1);
}
