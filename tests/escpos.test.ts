import { describe, expect, it } from 'vitest';
import { bgraToGray, decodeEscPos, encodeReceipt, packBits, THERMAL_PAPER } from '../src/core/escpos';

const raster = (w: number, h: number, black: (x: number, y: number) => boolean) => {
  const gray = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (black(x, y)) gray[y * w + x] = 0;
  return { width: w, height: h, gray };
};

describe('ESC/POS receipt encoding', () => {
  it('packs pixels MSB-first with black as 1 and pads the width to whole bytes', () => {
    const { bytesPerRow, data } = packBits(raster(10, 1, (x) => x === 0 || x === 9));
    expect(bytesPerRow).toBe(2);
    expect([...data]).toEqual([0b10000000, 0b01000000]);
  });

  it('starts with ESC @, uses GS v 0 raster blocks of the right size, feeds and cuts', () => {
    const r = raster(576, 300, (x, y) => (x + y) % 7 === 0);
    const out = encodeReceipt(r, { cut: true, copies: 1 });
    expect([...out.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...out.subarray(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0x00, 72, 0, 128, 0]); // 576 dots = 72 bytes, 128-row band
    expect([...out.subarray(out.length - 6)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x01]);
    const d = decodeEscPos(out);
    expect(d).toMatchObject({ width: 576, height: 300, receipts: 1, cuts: 1, startsWithInit: true });
    expect(d.bits).toHaveLength(72 * 300);
    // round trip: first pixel (0,0) is black, (1,0) is white
    expect(d.bits[0] & 0x80).toBe(0x80);
    expect(d.bits[0] & 0x40).toBe(0);
  });

  it('splits tall receipts into bands that add up to the full height', () => {
    const out = encodeReceipt(raster(384, 1000, () => false), { cut: false, copies: 1 });
    expect(decodeEscPos(out)).toMatchObject({ width: 384, height: 1000, cuts: 0 });
  });

  it('repeats the whole receipt for each copy, capped at 10, and can skip the cut', () => {
    const r = raster(8, 8, () => true);
    expect(decodeEscPos(encodeReceipt(r, { cut: true, copies: 3 }))).toMatchObject({ receipts: 3, cuts: 3, height: 24 });
    expect(decodeEscPos(encodeReceipt(r, { cut: false, copies: 99 })).receipts).toBe(10);
  });

  it('rejects an inconsistent raster and converts BGRA with transparency over white', () => {
    expect(() => encodeReceipt({ width: 4, height: 4, gray: new Uint8Array(3) }, { cut: false, copies: 1 })).toThrow();
    const bgra = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 128, 128, 128, 255]);
    expect([...bgraToGray(bgra, 4, 1).gray]).toEqual([0, 255, 255, 128]);
  });

  it('knows the dots per line for 80 mm and 58 mm paper', () => {
    expect(THERMAL_PAPER['80mm'].dots).toBe(576);
    expect(THERMAL_PAPER['58mm'].dots).toBe(384);
  });
});
