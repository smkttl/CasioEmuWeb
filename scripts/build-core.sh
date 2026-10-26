#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/CasioEmuMsvc"
OUT="$ROOT/public/core"

find_emscripten_root() {
  if [[ -n "${EMSCRIPTEN_ROOT:-}" ]]; then
    printf '%s\n' "$EMSCRIPTEN_ROOT"
  elif command -v emcc >/dev/null 2>&1; then
    local emcc_path
    emcc_path="$(readlink -f "$(command -v emcc)")"
    dirname "$emcc_path"
  elif [[ -n "${EMSDK:-}" && -f "$EMSDK/upstream/emscripten/emcc.py" ]]; then
    printf '%s\n' "$EMSDK/upstream/emscripten"
  fi
}

find_llvm_root() {
  if [[ -n "${EM_LLVM_ROOT:-}" ]]; then
    printf '%s\n' "$EM_LLVM_ROOT"
  elif [[ -n "${EMSDK:-}" && -d "$EMSDK/upstream/bin" ]]; then
    printf '%s\n' "$EMSDK/upstream/bin"
  elif command -v clang >/dev/null 2>&1; then
    local clang_path
    clang_path="$(readlink -f "$(command -v clang)")"
    dirname "$clang_path"
  fi
}

find_binaryen_root() {
  if [[ -n "${EM_BINARYEN_ROOT:-}" ]]; then
    printf '%s\n' "$EM_BINARYEN_ROOT"
  elif [[ -n "${EMSDK:-}" && -d "$EMSDK/upstream" ]]; then
    printf '%s\n' "$EMSDK/upstream"
  elif command -v wasm-opt >/dev/null 2>&1; then
    local wasm_opt_path
    wasm_opt_path="$(readlink -f "$(command -v wasm-opt)")"
    dirname "$(dirname "$wasm_opt_path")"
  fi
}

EMSCRIPTEN_ROOT="$(find_emscripten_root)"
EM_LLVM_ROOT="$(find_llvm_root)"
EM_BINARYEN_ROOT="$(find_binaryen_root)"

if [[ -z "$EMSCRIPTEN_ROOT" || ! -f "$EMSCRIPTEN_ROOT/emcc.py" ]]; then
  printf 'Could not find Emscripten. Set EMSCRIPTEN_ROOT to the directory containing emcc.py.\n' >&2
  exit 1
fi
if [[ -z "$EM_LLVM_ROOT" ]]; then
  printf 'Could not find Emscripten LLVM tools. Set EM_LLVM_ROOT.\n' >&2
  exit 1
fi
if [[ -z "$EM_BINARYEN_ROOT" ]]; then
  printf 'Could not find Binaryen. Set EM_BINARYEN_ROOT.\n' >&2
  exit 1
fi

export EM_NODE_JS="${EM_NODE_JS:-node}"
export PATH="$EM_LLVM_ROOT:$PATH"

mkdir -p "$OUT"
OBJ="$ROOT/.core-build"
mkdir -p "$OBJ"

SOURCES=(
  "$VENDOR/src/Emulator.cpp"
  "$VENDOR/src/ModelConfig.cpp"
  "$VENDOR/src/ModelResourceStore.cpp"
  "$VENDOR/src/SvgBoardModelLoader.cpp"
  "$VENDOR/src/QrCode.cpp"
  "$VENDOR/src/Chipset"/*.cpp
  $(find "$VENDOR/src/Peripheral" -maxdepth 1 -name '*.cpp' ! -name 'ScreenOutput.cpp' ! -name 'ScreenRenderSupport.cpp' | sort)
  "$VENDOR/src/Ext/U8Disas.cpp"
  "$VENDOR/src/Ext/ePSDisas.cpp"
  "$VENDOR/src/Ext/Romu.cpp"
  "$VENDOR/src/Ext/GameBuffer.cpp"
  "$VENDOR/src/Gui/Hooks.cpp"
  "$VENDOR/src/ReactCore/casioemu_react_api.cpp"
  "$VENDOR/src/ReactCore/react_globals.cpp"
  "$VENDOR/src/ReactCore/react_render_stubs.cpp"
  "$VENDOR/src/ReactCore/vibration_stub.cpp"
)

CSOURCES=(
  "$VENDOR/src/Chipset/EPS6800Core"/*.c
  "$VENDOR/third_party/miniz"/*.c
)

INCLUDES=(
  -I"$VENDOR"
  -I"$VENDOR/src"
  -I"$VENDOR/src/Chipset"
  -I"$VENDOR/src/Chipset/EPS6800Core"
  -I"$VENDOR/src/Containers"
  -I"$VENDOR/src/Ext"
  -I"$VENDOR/src/Ext/cam"
  -I"$VENDOR/src/Peripheral"
  -I"$VENDOR/src/Gui"
  -I"$VENDOR/third_party"
  -I"$VENDOR/third_party/miniz"
  -I"$VENDOR/third_party/tinyxml2"
)

DEFINES=(
  -DCASIOEMU_REACT_CORE
  -DCASIOEMU_CORE_WEB
  -DCASIOEMU_DISABLE_RAM_IMAGE
  -DDISABLE_SENTRY
  -DASMJIT_NO_JIT
  -DCASIOEMU_WEB
)

COMMON=(-O2 "${DEFINES[@]}" "${INCLUDES[@]}")
OBJECTS=()
index=0

compile_cpp() {
  local object="$OBJ/$index.o"
  OBJECTS+=("$object")
  python3 "$EMSCRIPTEN_ROOT/emcc.py" "${COMMON[@]}" -std=c++20 -fexceptions -c "$1" -o "$object"
  index=$((index + 1))
}

compile_c() {
  local object="$OBJ/$index.o"
  OBJECTS+=("$object")
  python3 "$EMSCRIPTEN_ROOT/emcc.py" "${COMMON[@]}" -std=c11 -c "$1" -o "$object"
  index=$((index + 1))
}

for source in "${SOURCES[@]}"; do
  compile_cpp "$source"
done
compile_cpp "$VENDOR/third_party/tinyxml2/tinyxml2.cpp"
for source in "${CSOURCES[@]}"; do
  compile_c "$source"
done

build() {
  python3 "$EMSCRIPTEN_ROOT/emcc.py" \
    "${OBJECTS[@]}" \
    -o "$OUT/casioemu-core.js" \
    -fexceptions \
    --no-entry \
    -sMODULARIZE=1 \
    -sEXPORT_NAME=CasioEmuCoreModule \
    -sALLOW_MEMORY_GROWTH=1 \
    -sEXIT_RUNTIME=0 \
    -sDISABLE_EXCEPTION_CATCHING=0 \
    -sFILESYSTEM=0 \
    -sEXPORTED_RUNTIME_METHODS='["UTF8ToString"]' \
    -sEXPORTED_FUNCTIONS='[
      "_ce_begin_model","_ce_add_resource","_ce_load_model","_ce_model_info_json",
      "_ce_shutdown","_ce_start","_ce_pause","_ce_reset","_ce_tick_frame",
      "_ce_frame_ptr","_ce_frame_width","_ce_frame_height","_ce_frame_has_status_row","_ce_status_alpha_ptr",
      "_ce_status_alpha_len","_ce_is_running","_ce_is_paused","_ce_set_display_color",
      "_ce_set_key","_ce_release_all","_ce_bind_key","_ce_unbind_key","_ce_handle_key",
      "_ce_read_memory","_ce_write_memory","_ce_pc","_ce_registers_json",
      "_ce_backtrace","_ce_disassemble","_ce_add_execution_breakpoint",
      "_ce_remove_execution_breakpoint","_ce_add_memory_breakpoint",
      "_ce_remove_memory_breakpoint","_ce_breakpoints_json","_ce_step_into",
      "_ce_step_over","_ce_step_out","_ce_continue","_ce_run_to",
      "_ce_stop_reason","_ce_snapshot_ptr","_ce_snapshot_len","_ce_save_snapshot",
      "_ce_restore_snapshot","_ce_save_persistent","_ce_load_persistent",
      "_ce_has_native_debugger","_ce_last_error","_ce_model_hardware","_malloc","_free"
    ]'
}

if [[ ! -f "$VENDOR/src/ReactCore/casioemu_react_api.cpp" ]]; then
  printf 'The vendored CasioEmuMsvc bridge sources are missing.\n' >&2
  exit 1
fi

if [[ "$(uname -s)" == "Linux" ]]; then
  export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}:$EM_LLVM_ROOT/../lib/x86_64-linux-gnu"
fi

build
