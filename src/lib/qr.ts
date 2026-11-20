/**
 * Minimal QR Code encoder (ISO/IEC 18004), no dependencies.
 * Byte mode, error-correction level M, versions 1–10 (up to 213 bytes),
 * which is plenty for a "bitcoin:<address>?amount=<btc>" payment URI.
 * Works in the browser and on the server.
 */

const ECC_CODEWORDS_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;
const ECL_M_FORMAT_BITS = 0; // M = 00

function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version: number): number {
  return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK_M[version] * NUM_BLOCKS_M[version];
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matrix {
  readonly version: number;
  readonly size: number;
  modules: boolean[][];
  isFunction: boolean[][];

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    const { size } = this;
    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFunction(x, y, dist !== 2 && dist !== 4);
        }
      }
    }
    const positions = alignmentPositions(this.version);
    const last = positions.length - 1;
    positions.forEach((px, i) => {
      positions.forEach((py, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            this.setFunction(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      });
    });
    this.drawFormatBits(0);
    this.drawVersionBits();
  }

  drawFormatBits(mask: number) {
    const data = (ECL_M_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    const { size } = this;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(i));
    this.setFunction(8, size - 8, true);
  }

  drawVersionBits() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawCodewords(codewords: number[]) {
    const { size } = this;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < codewords.length * 8) {
            this.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    const fn = MASKS[mask];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && fn(x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** Standard penalty score (rules 1–4); lower is better. */
  penalty(): number {
    const { size, modules } = this;
    let score = 0;
    const line = (get: (i: number, j: number) => boolean) => {
      for (let i = 0; i < size; i++) {
        let runColor = false;
        let run = 0;
        const bits: boolean[] = [];
        for (let j = 0; j < size; j++) {
          const c = get(i, j);
          bits.push(c);
          if (j > 0 && c === runColor) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score++;
          } else {
            runColor = c;
            run = 1;
          }
        }
        // Rule 3: 1:1:3:1:1 finder-like pattern with 4 light modules on a side.
        const padded = [false, false, false, false, ...bits, false, false, false, false];
        for (let j = 0; j + 11 <= padded.length; j++) {
          const p = padded.slice(j, j + 11).map((b) => (b ? 1 : 0)).join("");
          if (p === "10111010000" || p === "00001011101") score += 40;
        }
      }
    };
    line((i, j) => modules[i][j]);
    line((i, j) => modules[j][i]);
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
      }
    }
    let dark = 0;
    for (const row of modules) for (const c of row) if (c) dark++;
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** Encodes text (UTF-8, byte mode, ECC level M). Returns rows of dark(true)/light(false) modules. */
export function encodeQr(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  for (; version <= MAX_VERSION; version++) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= numDataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new Error("Text is too long for this QR encoder");

  const capacityBits = numDataCodewords(version) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  const numBlocks = NUM_BLOCKS_M[version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK_M[version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) codewords.push(block[i]);
    });
  }

  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = new Matrix(version);
    m.drawFunctionPatterns();
    m.drawCodewords(codewords);
    m.applyMask(mask);
    m.drawFormatBits(mask);
    const score = m.penalty();
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return (best as Matrix).modules;
}

/** SVG path ("M x y h1 v1 h-1 z" per dark module) including a 4-module quiet zone offset. */
export function qrSvgPath(modules: boolean[][], quietZone = 4): { path: string; size: number } {
  let path = "";
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quietZone} ${y + quietZone}h1v1h-1z`;
    }),
  );
  return { path, size: modules.length + quietZone * 2 };
}
