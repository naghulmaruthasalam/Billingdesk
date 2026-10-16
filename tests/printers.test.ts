import { describe, it, expect } from 'vitest';
import { looksThermal, resolveReceiptMethod } from '../src/shared/printers';
import { ensureSeeded } from '../src/core/seed';
import { getSetting, SETTING_DEFAULTS } from '../src/core/settings';
import { makeApp } from './helpers';

describe('printer detection', () => {
  it('recognises the shop RP-3200-LITE queue and other thermal printers', () => {
    expect(looksThermal({ name: 'RP-3200-LITE', model: 'Generic text-only printer' })).toBe(true);
    expect(looksThermal({ name: 'RP-3200-LITE', model: '' })).toBe(true);
    expect(looksThermal({ name: 'EPSON_TM-T82', model: 'EPSON TM-T82' })).toBe(true);
    expect(looksThermal({ name: 'Xprinter_XP-58', model: '' })).toBe(true);
    expect(looksThermal({ name: 'anything', model: 'Local Raw Printer' })).toBe(true);
    expect(looksThermal({ name: 'HP_LaserJet_1020', model: 'HP LaserJet 1020 Postscript' })).toBe(false);
    expect(looksThermal({ name: 'Brother_HL-L2350', model: 'Brother HL-L2350DW series' })).toBe(false);
    expect(looksThermal(undefined)).toBe(false);
  });

  it('automatic mode sends thermal queues as ESC/POS on Linux and everything else through the driver', () => {
    const rp = { name: 'RP-3200-LITE', model: 'Generic text-only printer' };
    const laser = { name: 'HP_LaserJet', model: 'HP LaserJet' };
    expect(resolveReceiptMethod('auto', rp, 'linux')).toBe('escpos');
    expect(resolveReceiptMethod('auto', laser, 'linux')).toBe('driver');
    expect(resolveReceiptMethod('auto', rp, 'win32')).toBe('driver'); // ESC/POS mode is Linux only
    expect(resolveReceiptMethod('driver', rp, 'linux')).toBe('driver'); // an explicit choice is respected
    expect(resolveReceiptMethod('escpos', laser, 'linux')).toBe('escpos');
  });

  it('new installs default to automatic, and the old "driver" default moves to automatic', async () => {
    const app = await makeApp();
    expect(SETTING_DEFAULTS['printing.receipt_method']).toBe('auto');
    expect(getSetting(app.rt.db, 'printing.receipt_method')).toBe('auto');
    await app.call('settings:update', { patch: { 'printing.receipt_method': 'driver' } });
    ensureSeeded(app.rt.db, new Date());
    expect(getSetting(app.rt.db, 'printing.receipt_method')).toBe('auto');
    await app.call('settings:update', { patch: { 'printing.receipt_method': 'escpos' } });
    ensureSeeded(app.rt.db, new Date());
    expect(getSetting(app.rt.db, 'printing.receipt_method')).toBe('escpos'); // other explicit choices are kept
  });
});
