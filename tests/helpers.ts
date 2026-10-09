import { Runtime } from '../src/core/runtime';
import { dispatch } from '../src/core/api';
import { AppError } from '../src/core/errors';
import type { ErrorCode } from '../src/core/errors';

export interface TestApp {
  rt: Runtime;
  /** Call an API channel; throws AppError on failure. */
  call: <T = any>(channel: string, payload?: unknown) => Promise<T>;
  /** Call and return the raw envelope. */
  raw: (channel: string, payload?: unknown) => ReturnType<typeof dispatch>;
  setClock: (d: Date) => void;
}

export const OWNER = { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' };

export async function makeApp(opts: { dbPath?: string; backupDir?: string; approve?: boolean; clock?: Date } = {}): Promise<TestApp> {
  let clock = opts.clock ?? new Date('2025-10-20T06:30:00Z'); // 12:00 IST
  const rt = Runtime.open({ dbPath: opts.dbPath ?? ':memory:', backupDir: opts.backupDir ?? '/tmp/sk-test-backups-unused', now: () => clock });
  const raw = (channel: string, payload?: unknown) => dispatch(rt, channel, payload);
  const call = async (channel: string, payload?: unknown) => {
    const r = await raw(channel, payload);
    if (!r.ok) throw new AppError(r.error.code as ErrorCode, r.error.message, r.error.details);
    return r.data as any;
  };
  const app: TestApp = { rt, call, raw, setClock: (d) => (clock = d) };
  if (!rt.signedIn) {
    const st = await call('auth:status');
    if (st.needsSetup) await call('auth:setup', OWNER);
    else await call('auth:login', { username: OWNER.username, password: OWNER.password });
  }
  if (opts.approve !== false) await approveCatalogue(app);
  return app;
}

/** Owner reviews every flagged entry and approves the catalogue (the real workflow, via the API). */
export async function approveCatalogue(app: TestApp): Promise<void> {
  const { rows } = await app.call('products:list', { reviewOnly: true });
  if (rows.length) await app.call('catalogue:markReviewed', { ids: rows.map((r: any) => r.id) });
  await app.call('catalogue:approve', { approved: true });
}

export async function product(app: TestApp, sku: string): Promise<any> {
  const { rows } = await app.call('products:list', { search: sku });
  const p = rows.find((r: any) => r.sku === sku);
  if (!p) throw new Error(`No product ${sku}`);
  return p;
}

export async function setStock(app: TestApp, sku: string, qty: number): Promise<any> {
  const p = await product(app, sku);
  await app.call('inventory:setOpening', { rows: [{ productId: p.id, qty }] });
  return product(app, sku);
}

let n = 0;
export const rid = (): string => `req-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

export async function expectError(p: Promise<unknown>, code: ErrorCode, messagePart?: string): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code !== code) throw new Error(`Expected error ${code} but got ${e.code}: ${e.message}`);
    if (messagePart && !e.message.toLowerCase().includes(messagePart.toLowerCase())) throw new Error(`Error message "${e.message}" lacks "${messagePart}"`);
    return e;
  }
  throw new Error(`Expected ${code} but the call succeeded`);
}

export async function addUser(app: TestApp, username: string, role: 'cashier' | 'inventory_manager', password = 'pass-1234'): Promise<void> {
  const roles = await app.call('roles:list');
  const r = roles.find((x: any) => x.name === role);
  await app.call('users:create', { username, displayName: username, password, roleId: r.id });
}

export async function loginAs(app: TestApp, username: string, password: string): Promise<void> {
  await app.call('auth:login', { username, password });
}
