export const MAX_BULK_MEMORY_BYTES = 1 << 20;

export class MemoryHexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryHexError";
  }
}

export function parseMemoryHex(text: string): Uint8Array {
  const bytes: number[] = [];
  let line = 1;
  let lineStart = 0;

  for (let offset = 0; offset < text.length; offset += 1) {
    const character = text[offset];
    if (character === "\n") {
      line += 1;
      lineStart = offset + 1;
      continue;
    }
    if (/\s/.test(character)) continue;

    const tokenStart = offset;
    while (offset < text.length && !/\s/.test(text[offset])) {
      offset += 1;
    }
    const token = text.slice(tokenStart, offset);
    offset -= 1;
    if (!/^[0-9a-fA-F]{2}$/.test(token)) {
      throw new MemoryHexError(
        `Invalid hex byte "${token}" on line ${line}, column ${
          tokenStart - lineStart + 1
        }. Enter two-digit bytes separated by whitespace.`,
      );
    }
    bytes.push(Number.parseInt(token, 16));
    if (bytes.length > MAX_BULK_MEMORY_BYTES) {
      throw new MemoryHexError(
        `The bulk edit exceeds the ${MAX_BULK_MEMORY_BYTES}-byte limit.`,
      );
    }
  }

  if (!bytes.length) {
    throw new MemoryHexError("Enter at least one two-digit hexadecimal byte.");
  }
  return Uint8Array.from(bytes);
}
