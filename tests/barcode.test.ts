import { describe, expect, it } from 'vitest';
import { EAN13_TOTAL_MODULES, ean13CheckDigit, ean13Modules, ean13Svg, internalEan13, isValidEan13 } from '../src/shared/barcode';

describe('EAN-13', () => {
  it('calculates check digits for published example codes', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(ean13CheckDigit('590123412345')).toBe(7); // 5901234123457
    expect(ean13CheckDigit('978020137962')).toBe(4); // ISBN 9780201379624
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('40063813339310')).toBe(false);
    expect(isValidEan13('ABCDEFGHIJKLM')).toBe(false);
  });

  it('encodes to exactly 95 modules with the correct guards and the known 4006381333931 pattern', () => {
    const m = ean13Modules('4006381333931');
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(92)).toBe('101');
    // First digit 4 => parity LGLLGG; digits 0,0,6,3,8,1 follow. Left half of the published symbol:
    expect(m.slice(3, 45)).toBe('0001101' + '0100111' + '0101111' + '0111101' + '0001001' + '0110011');
    // Right half (R codes) for 3,3,3,9,3,1
    expect(m.slice(50, 92)).toBe('1000010' + '1000010' + '1000010' + '1110100' + '1000010' + '1100110');
  });

  it('builds shop-internal codes that are valid, unique, numeric and start with the in-store prefix 2', () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 5000; i++) {
      const c = internalEan13(i);
      expect(c).toMatch(/^2\d{12}$/);
      expect(isValidEan13(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBe(5000);
    expect(internalEan13(1)).toBe('2000000000015');
    expect(() => internalEan13(0)).toThrow();
  });

  it('produces an SVG whose bars match the module pattern', () => {
    const code = internalEan13(45);
    const svg = ean13Svg(code, { width: '40mm' });
    expect(svg).toContain('viewBox="0 0 113');
    expect(svg).toContain(`aria-label="Barcode ${code}"`);
    expect(svg).toContain('width="40mm"');
    // Re-derive the black modules from the rects and compare with the encoder.
    const rects = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)].map((r) => [Number(r[1]), Number(r[2])]);
    const bits = Array(95).fill('0');
    for (const [x, w] of rects) for (let i = 0; i < w; i++) bits[x - 11 + i] = '1';
    expect(bits.join('')).toBe(ean13Modules(code));
    expect(EAN13_TOTAL_MODULES).toBe(113);
    expect(ean13Svg(code, { text: false })).not.toContain('<text');
    expect(() => ean13Svg('123')).toThrow();
  });
});
