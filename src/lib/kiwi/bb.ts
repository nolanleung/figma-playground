const int32 = new Int32Array(1);
const float32 = new Float32Array(int32.buffer);

export class ByteBuffer {
  private _data: Uint8Array;
  private _index: number;
  length: number;

  constructor(data?: Uint8Array) {
    if (data && !(data instanceof Uint8Array)) {
      throw new Error('Must initialize a ByteBuffer with a Uint8Array');
    }
    this._data = data || new Uint8Array(256);
    this._index = 0;
    this.length = data ? data.length : 0;
  }

  toUint8Array(): Uint8Array {
    return this._data.subarray(0, this.length);
  }

  readByte(): number {
    if (this._index + 1 > this._data.length) {
      throw new Error('Index out of bounds');
    }
    return this._data[this._index++];
  }

  readByteArray(): Uint8Array {
    const length = this.readVarUint();
    const start = this._index;
    const end = start + length;
    if (end > this._data.length) {
      throw new Error('Read array out of bounds');
    }
    this._index = end;
    // Copy into a new array instead of just creating another view.
    const result = new Uint8Array(length);
    result.set(this._data.subarray(start, end));
    return result;
  }

  readVarFloat(): number {
    const index = this._index;
    const data = this._data;
    const length = data.length;

    // Optimization: use a single byte to store zero
    if (index + 1 > length) {
      throw new Error('Index out of bounds');
    }
    const first = data[index];
    if (first === 0) {
      this._index = index + 1;
      return 0;
    }

    // Endian-independent 32-bit read
    if (index + 4 > length) {
      throw new Error('Index out of bounds');
    }
    let bits = first | (data[index + 1] << 8) | (data[index + 2] << 16) | (data[index + 3] << 24);
    this._index = index + 4;

    // Move the exponent back into place
    bits = (bits << 23) | (bits >>> 9);

    // Reinterpret as a floating-point number
    int32[0] = bits;
    return float32[0];
  }

  readVarUint(): number {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
       byte = this.readByte();
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    return value >>> 0;
  }

  readVarInt(): number {
    const value = this.readVarUint() | 0;
    return value & 1 ? ~(value >>> 1) : value >>> 1;
  }

  readVarUint64(): bigint {
    let value = BigInt(0);
    let shift = BigInt(0);
    const seven = BigInt(7);
    let byte: number;
    while ((byte = this.readByte()) & 128 && shift < 56) {
      value |= BigInt(byte & 127) << shift;
      shift += seven;
    }
    value |= BigInt(byte) << shift;
    return value;
  }

  readVarInt64(): bigint {
    let value = this.readVarUint64();
    const one = BigInt(1);
    const sign = value & one;
    value >>= one;
    return sign ? ~value : value;
  }

  readString(): string {
    let result = '';

    while (true) {
      let codePoint;

      // Decode UTF-8
      const a = this.readByte();
      if (a < 0xC0) {
        codePoint = a;
      } else {
        const b = this.readByte();
        if (a < 0xE0) {
          codePoint = ((a & 0x1F) << 6) | (b & 0x3F);
        } else {
          const c = this.readByte();
          if (a < 0xF0) {
            codePoint = ((a & 0x0F) << 12) | ((b & 0x3F) << 6) | (c & 0x3F);
          } else {
            const d = this.readByte();
            codePoint = ((a & 0x07) << 18) | ((b & 0x3F) << 12) | ((c & 0x3F) << 6) | (d & 0x3F);
          }
        }
      }

      // Strings are null-terminated
      if (codePoint === 0) {
        break;
      }

      // Encode UTF-16
      if (codePoint < 0x10000) {
        result += String.fromCharCode(codePoint);
      } else {
        codePoint -= 0x10000;
        result += String.fromCharCode((codePoint >> 10) + 0xD800, (codePoint & ((1 << 10) - 1)) + 0xDC00);
      }
    }

    return result;
  }

  private _growBy(amount: number): void {
    if (this.length + amount > this._data.length) {
      const data = new Uint8Array(this.length + amount << 1);
      data.set(this._data);
      this._data = data;
    }
    this.length += amount;
  }

  writeByte(value: number): void {
    const index = this.length;
    this._growBy(1);
    this._data[index] = value;
  }

  writeByteArray(value: Uint8Array): void {
    this.writeVarUint(value.length);
    const index = this.length;
    this._growBy(value.length);
    this._data.set(value, index);
  }

  writeVarFloat(value: number): void {
    const index = this.length;

    // Reinterpret as an integer
    float32[0] = value;
    let bits = int32[0];

    // Move the exponent to the first 8 bits
    bits = (bits >>> 23) | (bits << 9);

    // Optimization: use a single byte to store zero and denormals (check for an exponent of 0)
    if ((bits & 255) === 0) {
      this.writeByte(0);
      return;
    }

    // Endian-independent 32-bit write
    this._growBy(4);
    const data = this._data;
    data[index] = bits;
    data[index + 1] = bits >> 8;
    data[index + 2] = bits >> 16;
    data[index + 3] = bits >> 24;
  }

  writeVarUint(value: number): void {
    if (value < 0 || value > 0xFFFF_FFFF) throw new Error('Outside uint range: ' + value);
    do {
      const byte = value & 127;
      value >>>= 7;
      this.writeByte(value ? byte | 128 : byte);
    } while (value);
  }

  writeVarInt(value: number): void {
    if (value < -0x8000_0000 || value > 0x7FFF_FFFF) throw new Error('Outside int range: ' + value);
    this.writeVarUint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  writeVarUint64(value: bigint | string): void {
    if (typeof value === 'string') value = BigInt(value);
    else if (typeof value !== 'bigint') throw new Error('Expected bigint but got ' + typeof value + ': ' + value);
    if (value < 0 || value > BigInt('0xFFFFFFFFFFFFFFFF')) throw new Error('Outside uint64 range: ' + value);
    const mask = BigInt(127);
    const seven = BigInt(7);
    for (let i = 0; value > mask && i < 8; i++) {
      this.writeByte(Number(value & mask) | 128);
      value >>= seven;
    }
    this.writeByte(Number(value));
  }

  writeVarInt64(value: bigint | string): void {
    if (typeof value === 'string') value = BigInt(value);
    else if (typeof value !== 'bigint') throw new Error('Expected bigint but got ' + typeof value + ': ' + value);
    if (value < -BigInt('0x8000000000000000') || value > BigInt('0x7FFFFFFFFFFFFFFF')) throw new Error('Outside int64 range: ' + value);
    const one = BigInt(1);
    this.writeVarUint64(value < 0 ? ~(value << one) : value << one);
  }

  writeString(value: string): void {
    let codePoint;

    for (let i = 0; i < value.length; i++) {
      // Decode UTF-16
      const a = value.charCodeAt(i);
      if (i + 1 === value.length || a < 0xD800 || a >= 0xDC00) {
        codePoint = a;
      } else {
        const b = value.charCodeAt(++i);
        codePoint = (a << 10) + b + (0x10000 - (0xD800 << 10) - 0xDC00);
      }

      // Strings are null-terminated
      if (codePoint === 0) {
        throw new Error('Cannot encode a string containing the null character');
      }

      // Encode UTF-8
      if (codePoint < 0x80) {
        this.writeByte(codePoint);
      } else {
        if (codePoint < 0x800) {
          this.writeByte(((codePoint >> 6) & 0x1F) | 0xC0);
        } else {
          if (codePoint < 0x10000) {
            this.writeByte(((codePoint >> 12) & 0x0F) | 0xE0);
          } else {
            this.writeByte(((codePoint >> 18) & 0x07) | 0xF0);
            this.writeByte(((codePoint >> 12) & 0x3F) | 0x80);
          }
          this.writeByte(((codePoint >> 6) & 0x3F) | 0x80);
        }
        this.writeByte((codePoint & 0x3F) | 0x80);
      }
    }

    // Strings are null-terminated
    this.writeByte(0);
  }
}
