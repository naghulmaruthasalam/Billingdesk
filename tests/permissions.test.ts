import { describe, expect, it } from 'vitest';
import { makeApp, product, setStock, rid, expectError, addUser, loginAs, OWNER } from './helpers';
import { CHANNELS } from '../src/core/api';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/shared/permissions';

describe('authentication', () => {
  it('requires first-run setup, then login; unauthenticated calls are rejected', async () => {
    const app = await makeApp({ approve: false });
    await app.call('auth:logout');
    await expectError(app.call('products:list', {}), 'UNAUTHENTICATED');
    await expectError(app.call('auth:login', { username: 'owner', password: 'nope' }), 'UNAUTHENTICATED', 'Incorrect');
    await expectError(app.call('auth:login', { username: 'ghost', password: 'nope' }), 'UNAUTHENTICATED', 'Incorrect');
    const u = await app.call('auth:login', { username: 'OWNER', password: OWNER.password });
    expect(u.role).toBe('owner');
    expect((await app.call('auth:status')).needsSetup).toBe(false);
    await expectError(app.call('auth:setup', { username: 'second', displayName: 'x', password: 'abcdef' }), 'CONFLICT');
  });

  it('never stores plaintext passwords and locks after repeated failures', async () => {
    const app = await makeApp({ approve: false });
    const row = app.rt.db.prepare('SELECT password_hash FROM users WHERE username = ?').get('owner') as { password_hash: string };
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row.password_hash).not.toContain(OWNER.password);
    await app.call('auth:logout');
    for (let i = 0; i < 5; i++) await app.raw('auth:login', { username: 'owner', password: 'bad' });
    await expectError(app.call('auth:login', { username: 'owner', password: OWNER.password }), 'LOCKED');
  });

  it('recovers the owner with the one-time recovery code without touching business data', async () => {
    const app = await makeApp({ approve: false });
    const dbPath = ':memory:';
    void dbPath;
    // run setup again on a fresh app to capture the recovery code
    const fresh = await (async () => {
      const { Runtime } = await import('../src/core/runtime');
      const { dispatch } = await import('../src/core/api');
      const rt = Runtime.open({ dbPath: ':memory:', backupDir: '/tmp/unused' });
      const setup: any = await dispatch(rt, 'auth:setup', OWNER);
      return { rt, dispatch, code: setup.data.recoveryCode as string };
    })();
    expect(fresh.code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
    await fresh.dispatch(fresh.rt, 'auth:logout', {});
    const bad: any = await fresh.dispatch(fresh.rt, 'auth:recover', { recoveryCode: 'AAAA-AAAA-AAAA-AAAA-AAAA', newPassword: 'new-pass-9' });
    expect(bad.ok).toBe(false);
    const ok: any = await fresh.dispatch(fresh.rt, 'auth:recover', { recoveryCode: fresh.code.toLowerCase(), newPassword: 'new-pass-9' });
    expect(ok.ok).toBe(true);
    expect(ok.data.recoveryCode).not.toBe(fresh.code); // rotated
    const login: any = await fresh.dispatch(fresh.rt, 'auth:login', { username: 'owner', password: 'new-pass-9' });
    expect(login.ok).toBe(true);
    const prods: any = await fresh.dispatch(fresh.rt, 'products:list', {});
    expect(prods.data.total).toBe(114);
    const reuse: any = await fresh.dispatch(fresh.rt, 'auth:recover', { recoveryCode: fresh.code, newPassword: 'another-1' });
    expect(reuse.ok).toBe(false);
    void app;
  });
});

describe('role-based permissions are enforced in the backend', () => {
  it('lets a cashier bill and view products but not manage them', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 5);
    await addUser(app, 'asha', 'cashier');
    await loginAs(app, 'asha', 'pass-1234');
    const inv = await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 5000 }] });
    expect(inv.cashier).toBe('asha');
    expect((await app.call('products:list', {})).total).toBe(114);
    // cost prices are hidden from cashiers
    expect((await app.call('products:get', { id: p.id })).costPaise).toBeNull();
    const data = { nameEn: 'x', nameTa: '', categoryId: p.categoryId, unit: 'Box', pricePaise: 1, minStock: 0, discountRule: 'inherit', active: true };
    for (const [ch, payload] of [
      ['products:update', { id: p.id, data }],
      ['products:create', data],
      ['inventory:adjust', { productId: p.id, mode: 'delta', qty: 5, reason: 'free stock' }],
      ['purchases:list', {}],
      ['reports:run', { name: 'sales_summary', from: '2025-10-01', to: '2025-10-31' }],
      ['dashboard:get', {}],
      ['users:list', {}],
      ['settings:update', { patch: { 'discount.default_bp': 5000 } }],
      ['backup:list', {}],
      ['audit:list', {}],
      ['catalogue:approve', { approved: false }],
      ['expenses:list', {}],
      ['catalogue:export', {}],
    ] as const) {
      const r: any = await app.raw(ch, payload);
      expect(r.ok, ch).toBe(false);
      expect(r.error.code, ch).toBe('FORBIDDEN');
    }
    // settings that billing needs are readable
    expect((await app.call('settings:get'))['discount.default_bp']).toBe(1000);
  });

  it('lets an inventory manager adjust stock and purchase but not bill or cancel', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 5);
    await addUser(app, 'ravi', 'inventory_manager');
    await loginAs(app, 'ravi', 'pass-1234');
    await app.call('inventory:adjust', { productId: p.id, mode: 'delta', qty: -1, type: 'damage', reason: 'Water damage' });
    await app.call('purchases:create', { purchaseDate: '2025-10-20', lines: [{ productId: p.id, qty: 10, unitCostPaise: 1800 }] });
    expect((await product(app, 'SK-002')).stockQty).toBe(14);
    expect((await product(app, 'SK-002')).costPaise).toBe(1800);
    await expectError(app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 5000 }] }), 'FORBIDDEN');
    await expectError(app.call('users:list'), 'FORBIDDEN');
  });

  it('applies permission changes immediately to a signed-in user', async () => {
    const app = await makeApp();
    const roles = await app.call('roles:list');
    const cashier = roles.find((r: any) => r.name === 'cashier');
    await addUser(app, 'asha', 'cashier');
    await expectError(app.call('roles:setPermissions', { roleId: cashier.id, permissions: [], confirmPassword: 'wrong' }), 'FORBIDDEN');
    await loginAs(app, 'asha', 'pass-1234');
    expect((await app.raw('products:list', {})).ok).toBe(true);
    await loginAs(app, 'owner', OWNER.password);
    await app.call('roles:setPermissions', { roleId: cashier.id, permissions: DEFAULT_ROLE_PERMISSIONS.cashier.filter((p) => p !== 'products.view' && p !== 'billing.create'), confirmPassword: OWNER.password });
    await loginAs(app, 'asha', 'pass-1234');
    await expectError(app.call('products:list', {}), 'FORBIDDEN');
    const owner = roles.find((r: any) => r.name === 'owner');
    await loginAs(app, 'owner', OWNER.password);
    await expectError(app.call('roles:setPermissions', { roleId: owner.id, permissions: [], confirmPassword: OWNER.password }), 'VALIDATION', 'owner role');
  });

  it('keeps at least one active owner and audits user and permission changes', async () => {
    const app = await makeApp();
    const users = await app.call('users:list');
    await expectError(app.call('users:update', { id: users[0].id, data: { active: false }, confirmPassword: OWNER.password }), 'VALIDATION', 'owner');
    await addUser(app, 'asha', 'cashier');
    await app.call('users:update', { id: (await app.call('users:list')).find((u: any) => u.username === 'asha').id, data: { active: false }, confirmPassword: OWNER.password });
    await expectError(app.call('auth:login', { username: 'asha', password: 'pass-1234' }), 'UNAUTHENTICATED', 'disabled');
    const actions = (await app.call('audit:list', {})).rows.map((r: any) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['user.create', 'user.update']));
  });

  it('protects every channel: only the public ones work signed-out', async () => {
    const app = await makeApp();
    await app.call('auth:logout');
    const open: string[] = [];
    for (const ch of CHANNELS) {
      const r: any = await app.raw(ch, {});
      if (r.ok || r.error.code !== 'UNAUTHENTICATED') open.push(ch);
    }
    expect(open.sort()).toEqual(['auth:login', 'auth:logout', 'auth:recover', 'auth:setup', 'auth:status']);
    expect((await app.raw('does:notexist', {})) as any).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect((await app.raw('__proto__', {})) as any).toMatchObject({ ok: false });
  });
});
