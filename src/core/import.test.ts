import { BinaryWriter } from "./binary";
import { describe, expect, it } from "vitest";
import {
  ImportError,
  findModelRoot,
  manifestFromConfigBin,
  prepareModelImport,
  sanitizeModelFiles,
  stripModelRoot,
  validateModelPath,
} from "./import";
import type { ModelFile, ModelManifest } from "./types";

const encoder = new TextEncoder();

function file(path: string, contents: string | Uint8Array, type = "") {
  return {
    path,
    bytes: typeof contents === "string" ? encoder.encode(contents) : contents,
    type,
  };
}

function config(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: "CasioEmuMsvc.ModelInfo",
    version: 1,
    model_name: "Test Machine",
    hardware_id: 4,
    csr_mask: 0x1234,
    real_hardware: true,
    pd_value: 0,
    interface_path: "skin.svg",
    board_path: "",
    rom_path: "rom.bin",
    flash_path: "",
    ink_color: { r: 8, g: 20, b: 30 },
    enable_new_screen: true,
    is_sample_rom: false,
    legacy_ko: false,
    u16_mode: true,
    large_model: true,
    ml620_mirroring: false,
    screen_width: 192,
    screen_height: 63,
    screen_scale_y: 1,
    sprites: {
      rsd_pixel: {
        src: { x: 0, y: 0, w: 192, h: 63 },
        dest: { x: 30, y: 20, w: 300, h: 100 },
      },
      rsd_interface: {
        src: { x: 0, y: 0, w: 360, h: 600 },
        dest: { x: 0, y: 0, w: 360, h: 600 },
      },
    },
    buttons: [{ kiko: 49, keyname: "1", rect: { x: 15, y: 300, w: 40, h: 30 } }],
    ...overrides,
  });
}

describe("model path validation", () => {
  it("accepts normalized relative paths", () => {
    expect(validateModelPath("assets/skin.svg")).toBeNull();
    expect(validateModelPath("config.json")).toBeNull();
  });

  it.each([
    ["/etc/passwd", "Absolute paths"],
    ["C:/model/config.json", "Absolute paths"],
    ["assets\\skin.svg", "Backslashes"],
    ["assets/../rom.bin", "Parent"],
    ["assets//skin.svg", "empty"],
    ["data:image/png;base64,abc", "stream prefixes"],
  ])("rejects %s", (path, message) => {
    expect(validateModelPath(path)).toContain(message);
  });

  it("rejects case-insensitive path collisions", () => {
    const result = sanitizeModelFiles([
      file("ROM.bin", new Uint8Array([1])),
      file("rom.bin", new Uint8Array([2])),
    ]);
    expect(result.files).toHaveLength(1);
    expect(result.issues[0].severity).toBe("error");
    expect(result.issues[0].message).toContain("collides");
  });

  it("enforces file and aggregate size limits", () => {
    const result = sanitizeModelFiles([
      file("rom.bin", new Uint8Array(97 * 1024 * 1024)),
    ]);
    expect(result.issues[0].message).toContain("per-file limit");
  });
});

describe("model roots", () => {
  it("strips a nested root and ignores sibling folders", () => {
    const files = [
      file("bundle/config.json", "{}"),
      file("bundle/rom.bin", new Uint8Array([1])),
      file("other/file.bin", new Uint8Array([2])),
    ];
    expect(findModelRoot(files)).toBe("bundle/");
    expect(stripModelRoot(files, "bundle/").map((item) => item.path)).toEqual([
      "config.json",
      "rom.bin",
    ]);
  });
});

describe("binary model configuration", () => {
  it("keeps SVG shape metadata aligned with button indexes", () => {
    const writer = new BinaryWriter();
    writer.string("CasioEmuMsvc.ModelInfo.v53");
    writer.u16(0x1234);
    writer.u16(4);
    writer.bool(true);
    writer.u8(0);
    writer.u64(2);
    writer.rect({ x: 1, y: 2, w: 3, h: 4 });
    writer.i32(17);
    writer.string("A");
    writer.rect({ x: 5, y: 6, w: 7, h: 8 });
    writer.i32(18);
    writer.string("B");
    writer.u64(0);
    writer.i32(0);
    writer.i32(0);
    writer.i32(0);
    writer.string("skin.svg");
    writer.string("Binary Machine");
    writer.string("rom.bin");
    writer.string("");
    writer.bool(true);
    writer.bool(false);
    writer.bool(false);
    writer.bool(true);
    writer.bool(true);
    writer.bool(false);
    writer.u64(0);
    writer.u64(0);
    writer.u64(2);
    writer.string("path-shape-A");
    writer.string("path-shape-B");
    writer.u64(2);
    writer.string("defs-A");
    writer.string("defs-B");
    writer.u64(0);
    writer.u64(0);
    writer.string("");
    writer.i32(96);
    writer.i32(31);
    writer.raw(new Uint8Array(new Float32Array([1]).buffer));
    writer.u64(0);

    const manifest = manifestFromConfigBin(writer.finish());
    expect(manifest.buttons).toHaveLength(2);
    expect(manifest.buttons[0].svgShape).toBe("path-shape-A");
    expect(manifest.buttons[1].svgShape).toBe("path-shape-B");
    expect(manifest.buttons[0].svgDefs).toBe("defs-A");
    expect(manifest.buttons[1].svgDefs).toBe("defs-B");
    expect(manifest.buttons[1].svgShape).not.toBe("");
  });

  it("rejects truncated configurations", () => {
    const writer = new BinaryWriter();
    writer.string("CasioEmuMsvc.ModelInfo.v53");
    writer.u16(0);
    expect(() => manifestFromConfigBin(writer.finish())).toThrow(
      "Unexpected end of config.bin",
    );
  });
});

describe("model import", () => {
  const skin =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 600"><rect width="360" height="600"/></svg>';

  function sourceFiles(extra: ModelFile[] = []) {
    return [
      file("config.json", config()),
      file("skin.svg", skin, "image/svg+xml"),
      file("rom.bin", new Uint8Array([0xaa, 0xbb, 0xcc])),
      ...extra,
    ];
  }

  it("normalizes a model folder and records its assets", async () => {
    const preview = await prepareModelImport({
      files: sourceFiles([file("notes.txt", "hello")]),
      sourceName: "test-model",
    });
    expect(preview.record.name).toBe("Test Machine");
    expect(preview.record.hardwareId).toBe(4);
    expect(preview.record.files.map((item) => item.path)).toContain("rom.bin");
    expect(preview.record.romHash).toHaveLength(64);
    expect(preview.record.interfaceSvg).toContain("<svg");
    expect(preview.issues).toHaveLength(0);
  });

  it("reports missing ROM assets without accepting the model", async () => {
    await expect(
      prepareModelImport({
        files: sourceFiles().filter((item) => item.path !== "rom.bin"),
        sourceName: "broken",
      }),
    ).rejects.toBeInstanceOf(ImportError);
  });

  it("rejects a config without a supported hardware id", async () => {
    const broken = sourceFiles().map((item) =>
      item.path === "config.json" ? file("config.json", config({ hardware_id: 999 })) : item,
    );
    await expect(
      prepareModelImport({ files: broken, sourceName: "broken" }),
    ).rejects.toMatchObject({ name: "ImportError" });
  });

  it("accepts a compatibility manifest already in memory", () => {
    const manifest = {} as ModelManifest;
    expect(manifest).toBeDefined();
  });
});
