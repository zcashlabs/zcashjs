// TextDecoder fallback for engines without a conforming one (Hermes): WHATWG UTF-8
// with fatal/ignoreBOM/stream, and ASCII/latin1 (windows-1252 labels).
type Decoder = { decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string };

export /** UTF-8 (the WHATWG decoder, with fatal/ignoreBOM/stream) and ASCII/latin1 decoding. */
class FallbackTextDecoder implements Decoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  // WHATWG UTF-8 decoder state, kept across streamed calls.
  private codePoint = 0;
  private needed = 0;
  private seen = 0;
  private lower = 0x80;
  private upper = 0xbf;
  private bomHandled = false;

  constructor(label = 'utf-8', options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
    const name = String(label).trim().toLowerCase();
    if (name === 'utf-8' || name === 'utf8' || name === 'unicode-1-1-utf-8') this.encoding = 'utf-8';
    else if (['ascii', 'us-ascii', 'latin1', 'iso-8859-1', 'windows-1252'].includes(name)) {
      this.encoding = 'windows-1252';
    } else throw new RangeError(`The encoding label provided ('${label}') is invalid.`);
    this.fatal = options.fatal === true;
    this.ignoreBOM = options.ignoreBOM === true;
  }

  private reset() {
    this.codePoint = 0;
    this.needed = 0;
    this.seen = 0;
    this.lower = 0x80;
    this.upper = 0xbf;
  }

  decode(input?: ArrayBufferView | ArrayBuffer, options: { stream?: boolean } = {}): string {
    const bytes = input === undefined
      ? new Uint8Array(0)
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const chunks: string[] = [];
    let units: number[] = [];
    const flush = () => {
      chunks.push(String.fromCharCode(...units));
      units = [];
    };
    if (this.encoding !== 'utf-8') {
      for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
      return chunks.join('');
    }
    const error = () => {
      if (this.fatal) {
        this.reset();
        this.bomHandled = false;
        throw new TypeError('The encoded data was not valid for encoding utf-8');
      }
      units.push(0xfffd);
    };
    const emit = (code: number) => {
      if (!this.bomHandled) {
        this.bomHandled = true;
        if (code === 0xfeff && !this.ignoreBOM) return;
      }
      if (code > 0xffff) {
        const value = code - 0x10000;
        units.push(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
      } else units.push(code);
      if (units.length >= 8192) flush();
    };
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (this.needed === 0) {
        if (byte <= 0x7f) emit(byte);
        else if (byte >= 0xc2 && byte <= 0xdf) {
          this.needed = 1;
          this.codePoint = byte & 0x1f;
        } else if (byte >= 0xe0 && byte <= 0xef) {
          if (byte === 0xe0) this.lower = 0xa0;
          if (byte === 0xed) this.upper = 0x9f;
          this.needed = 2;
          this.codePoint = byte & 0x0f;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          if (byte === 0xf0) this.lower = 0x90;
          if (byte === 0xf4) this.upper = 0x8f;
          this.needed = 3;
          this.codePoint = byte & 0x07;
        } else error();
        continue;
      }
      if (byte < this.lower || byte > this.upper) {
        this.reset();
        error();
        i--; // Reprocess this byte as the start of a new sequence.
        continue;
      }
      this.lower = 0x80;
      this.upper = 0xbf;
      this.codePoint = (this.codePoint << 6) | (byte & 0x3f);
      if (++this.seen === this.needed) {
        const code = this.codePoint;
        this.reset();
        emit(code);
      }
    }
    if (options.stream !== true) {
      if (this.needed !== 0) {
        this.reset();
        error();
      }
      this.bomHandled = false;
    }
    flush();
    return chunks.join('');
  }
}
