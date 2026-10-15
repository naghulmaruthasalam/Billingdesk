import { describe, expect, it } from 'vitest';
import { makeApp, expectError, addUser, loginAs, OWNER } from './helpers';

describe('printer settings', () => {
  it('start with no printer chosen, ask-each-time, one receipt copy and auto-print off', async () => {
    const app = await makeApp({ approve: false });
    const s = await app.call('settings:get');
    expect(s['printing.receipt_printer']).toBe('');
    expect(s['printing.label_printer']).toBe('');
    expect(s['printing.silent']).toBe(false);
    expect(s['printing.receipt_copies']).toBe(1);
    expect(s['printing.auto_print']).toBe(false);
  });

  it('saves and audits printer choices and validates copies', async () => {
    const app = await makeApp({ approve: false });
    await app.call('settings:update', { patch: { 'printing.receipt_printer': 'EPSON TM-T82', 'printing.label_printer': 'TSC TE244', 'printing.silent': true, 'printing.receipt_copies': 2, 'printing.auto_print': true } });
    const s = await app.call('settings:get');
    expect(s['printing.receipt_printer']).toBe('EPSON TM-T82');
    expect(s['printing.receipt_copies']).toBe(2);
    const log = (await app.call('audit:list', { action: 'settings.update' })).rows[0];
    expect(JSON.parse(log.details)['printing.receipt_printer']).toEqual({ from: '', to: 'EPSON TM-T82' });
    await expectError(app.call('settings:update', { patch: { 'printing.receipt_copies': 0 } }), 'VALIDATION');
    await expectError(app.call('settings:update', { patch: { 'printing.receipt_copies': 9 } }), 'VALIDATION');
    await expectError(app.call('settings:update', { patch: { 'printing.silent': 'yes' } }), 'VALIDATION');
  });

  it('only users with settings permission can change printers', async () => {
    const app = await makeApp({ approve: false });
    await addUser(app, 'asha', 'cashier');
    await loginAs(app, 'asha', 'pass-1234');
    await expectError(app.call('settings:update', { patch: { 'printing.receipt_printer': 'Other' } }), 'FORBIDDEN');
    expect((await app.call('settings:get'))['printing.silent']).toBe(false); // cashiers can read what billing needs
    await loginAs(app, 'owner', OWNER.password);
  });
});
