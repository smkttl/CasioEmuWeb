const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export class BinaryReader {
  private offset = 0;
  private view: DataView;

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  get position() {
    return this.offset;
  }

  get remaining() {
    return this.buffer.byteLength - this.offset;
  }

  private ensure(size: number) {
    if (this.offset + size > this.buffer.byteLength) {
      throw new Error(`Unexpected end of config.bin at byte ${this.offset}.`);
    }
  }

  u8() {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  i8() {
    this.ensure(1);
    return this.view.getInt8(this.offset++);
  }

  bool() {
    return this.u8() !== 0;
  }

  u16() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i32() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64() {
    this.ensure(8);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("config.bin contains an unsupported large value.");
    }
    return Number(value);
  }

  string() {
    const length = this.u64();
    this.ensure(length);
    const value = textDecoder.decode(
      this.buffer.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return value;
  }

  rect() {
    return { x: this.i32(), y: this.i32(), w: this.i32(), h: this.i32() };
  }

  sprite() {
    return { src: this.rect(), dest: this.rect() };
  }

  skip(count: number) {
    this.ensure(count);
    this.offset += count;
  }

  bytes(count: number) {
    this.ensure(count);
    const value = this.buffer.slice(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }
}

export class BinaryWriter {
  private chunks: Uint8Array[] = [];

  u8(value: number) {
    this.chunks.push(new Uint8Array([value & 0xff]));
  }

  bool(value: boolean) {
    this.u8(value ? 1 : 0);
  }

  u16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.chunks.push(bytes);
  }

  i32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    this.chunks.push(bytes);
  }

  u64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
    this.chunks.push(bytes);
  }

  string(value: string) {
    const bytes = textEncoder.encode(value);
    this.u64(bytes.byteLength);
    this.chunks.push(bytes);
  }

  rect(rect: { x: number; y: number; w: number; h: number }) {
    this.i32(rect.x);
    this.i32(rect.y);
    this.i32(rect.w);
    this.i32(rect.h);
  }

  raw(bytes: Uint8Array) {
    this.chunks.push(bytes);
  }

  finish() {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}
