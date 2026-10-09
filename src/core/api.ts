import { z, ZodError, type ZodType } from 'zod';
import { Buffer } from 'node:buffer';
import type { Runtime } from './runtime';
import type { Ctx, SessionUser } from './types';
import { AppError } from './errors';
import type { Permission } from '../shared/permissions';
import * as auth from './auth';
import * as settings from './settings';
import * as products from './products';
import * as catalogueIo from './catalogue-io';
import * as inventory from './inventory';
import * as purchases from './purchases';
import * as billing from './billing';
import * as returns from './returns';
import * as customers from './customers';
import * as expenses from './expenses';
import * as users from './users';
import * as reports from './reports';
import * as backup from './backup';
import { audit, listAudit } from './audit';
import { resetCatalogueToPrinted } from './seed';
import { csvToObjects, parseCsv, toCsv } from './csv';
import { toXlsx } from './xlsx';
import { businessDate, isDateString } from './time';
import { renderInvoiceHtml, type PrintableInvoice, type PrintableShop, type ReceiptSize } from '../shared/invoiceHtml';
import { requirePermission, can } from './authz';

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

type Access = 'public' | 'authed' | Permission | Permission[];

interface Handler {
  access: Access;
  schema?: ZodType<any>;
  run: (rt: Runtime, input: any, ctx: Ctx | null) => unknown | Promise<unknown>;
}

const id = z.object({ id: z.number().int().positive() });
const dateRange = z.object({ from: z.string().refine(isDateString).optional(), to: z.string().refine(isDateString).optional() });
const page = { limit: z.number().int().min(1).max(5000).optional(), offset: z.number().int().min(0).optional() };

const stripCost = (ctx: Ctx, p: products.ProductDTO): products.ProductDTO => (can(ctx, 'products.edit') || can(ctx, 'inventory.adjust') || can(ctx, 'purchases.manage') ? p : { ...p, costPaise: null });

export function shopForPrint(rt: Runtime): PrintableShop {
  const g = <K extends settings.SettingKey>(k: K) => settings.getSetting(rt.db, k);
  return {
    nameEn: g('shop.name_en'),
    nameTa: g('shop.name_ta'),
    address: g('shop.address'),
    addressTa: g('shop.address_ta'),
    phones: g('shop.phones'),
    taxId: g('shop.tax_id'),
    logoDataUrl: g('shop.logo_data_url'),
    footerEn: g('invoice.footer_en'),
    footerTa: g('invoice.footer_ta'),
    taxLabel: g('tax.label'),
    showTamil: g('invoice.show_tamil'),
  };
}

/** Build the printable HTML for an invoice. Requires the owner to have confirmed the shop address. */
export function buildInvoiceHtml(rt: Runtime, ctx: Ctx, invoiceId: number, size: ReceiptSize | undefined, fontBase: string, opts: { autoPrint?: boolean; allowUnconfirmed?: boolean } = {}): string {
  requirePermission(ctx, 'billing.reprint');
  if (!opts.allowUnconfirmed && !settings.getSetting(rt.db, 'setup.address_confirmed')) {
    throw new AppError('SETUP_INCOMPLETE', 'Invoice printing is disabled until the owner confirms the shop name, address and phone numbers in Settings.');
  }
  const inv = billing.getInvoice(rt.db, invoiceId);
  // "DUPLICATE COPY" is only printed once the original has gone to the printer / PDF at least once.
  const printedBefore = !!rt.db.prepare("SELECT 1 FROM audit_logs WHERE action = 'invoice.print' AND entity = 'invoices' AND entity_id = ? LIMIT 1").get(String(invoiceId));
  const printable: PrintableInvoice = { ...inv, reprint: printedBefore };
  return renderInvoiceHtml(printable, shopForPrint(rt), { size: size ?? settings.getSetting(rt.db, 'invoice.receipt_size'), fontBase, autoPrint: opts.autoPrint });
}

const HANDLERS: Record<string, Handler> = {
  // ----------------------------------------------------------------- auth
  'auth:status': {
    access: 'public',
    run: (rt) => ({ needsSetup: auth.needsSetup(rt.db), user: rt.user(), shopName: settings.getSetting(rt.db, 'shop.name_en') }),
  },
  'auth:setup': {
    access: 'public',
    schema: z.object({ username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9._-]+$/), displayName: z.string().trim().min(1).max(80), password: z.string().min(1) }),
    run: (rt, i) => {
      const r = auth.setupOwner(rt.db, rt.now(), i);
      rt.setSession(r.user.id);
      return r;
    },
  },
  'auth:login': {
    access: 'public',
    schema: z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }),
    run: (rt, i) => {
      const u = auth.login(rt.db, rt.now(), i.username, i.password);
      rt.setSession(u.id);
      return u;
    },
  },
  'auth:logout': { access: 'public', run: (rt) => { rt.setSession(null); return true; } },
  'auth:recover': {
    access: 'public',
    schema: z.object({ recoveryCode: z.string().min(8).max(64), newPassword: z.string().min(1).max(200) }),
    run: (rt, i) => auth.recoverOwner(rt.db, rt.now(), i),
  },
  'auth:changePassword': {
    access: 'authed',
    schema: z.object({ current: z.string(), next: z.string() }),
    run: (_rt, i, ctx) => { auth.changeOwnPassword(ctx!, i.current, i.next); return true; },
  },

  // ------------------------------------------------------------- settings
  'settings:get': { access: 'authed', run: (rt) => settings.getAllSettings(rt.db) },
  'settings:update': {
    access: 'settings.manage',
    schema: z.object({ patch: z.record(z.string(), z.unknown()) }),
    run: (_rt, i, ctx) => settings.updateSettings(ctx!, i.patch),
  },
  'settings:confirmAddress': {
    access: 'settings.manage',
    run: (rt, _i, ctx) => {
      settings.putSetting(rt.db, rt.now(), 'setup.address_confirmed', true);
      audit(ctx!, { action: 'settings.confirm_address', entity: 'settings', details: { address: settings.getSetting(rt.db, 'shop.address') } });
      return settings.getAllSettings(rt.db);
    },
  },

  // ------------------------------------------------------------ catalogue
  'categories:list': { access: 'authed', run: (rt) => products.listCategories(rt.db) },
  'categories:save': { access: 'products.edit', schema: z.object({ id: z.number().int().positive().nullable(), data: products.categoryInputSchema }), run: (_rt, i, ctx) => products.saveCategory(ctx!, i.id, i.data) },
  'products:list': {
    access: ['products.view', 'billing.create'],
    schema: z.object({ search: z.string().max(100).optional(), categoryId: z.number().int().optional(), activeOnly: z.boolean().optional(), sellableOnly: z.boolean().optional(), reviewOnly: z.boolean().optional(), lowStockOnly: z.boolean().optional(), ...page }),
    run: (rt, i, ctx) => {
      const r = products.listProducts(rt.db, i);
      return { rows: r.rows.map((p) => stripCost(ctx!, p)), total: r.total };
    },
  },
  'products:get': { access: ['products.view', 'billing.create'], schema: id, run: (rt, i, ctx) => stripCost(ctx!, products.getProduct(rt.db, i.id)) },
  'products:byCode': { access: ['products.view', 'billing.create'], schema: z.object({ code: z.string().min(1).max(60) }), run: (rt, i, ctx) => { const p = products.findByBarcodeOrSku(rt.db, i.code); return p ? stripCost(ctx!, p) : null; } },
  'products:create': { access: 'products.edit', schema: products.productInputSchema, run: (_rt, i, ctx) => products.createProduct(ctx!, i) },
  'products:update': { access: 'products.edit', schema: z.object({ id: z.number().int().positive(), data: products.productInputSchema.omit({ openingStock: true }) }), run: (_rt, i, ctx) => products.updateProduct(ctx!, i.id, i.data) },
  'products:setActive': { access: 'products.edit', schema: z.object({ id: z.number().int().positive(), active: z.boolean() }), run: (_rt, i, ctx) => { products.setProductActive(ctx!, i.id, i.active); return true; } },
  'catalogue:status': { access: 'authed', run: (rt) => products.catalogueStatus(rt.db) },
  'catalogue:markReviewed': { access: 'products.edit', schema: z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) }), run: (_rt, i, ctx) => products.markReviewed(ctx!, i.ids) },
  'catalogue:flag': { access: 'products.edit', schema: z.object({ id: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }), run: (_rt, i, ctx) => { products.flagForReview(ctx!, i.id, i.reason); return true; } },
  'catalogue:approve': {
    access: 'catalogue.approve',
    schema: z.object({ approved: z.boolean() }),
    run: (_rt, i, ctx) => products.setCatalogueApproved(ctx!, i.approved),
  },
  'catalogue:reset': {
    access: 'catalogue.approve',
    schema: z.object({ confirmPassword: z.string() }),
    run: (_rt, i, ctx) => {
      auth.confirmOwnPassword(ctx!, i.confirmPassword);
      return resetCatalogueToPrinted(ctx!);
    },
  },
  'catalogue:export': {
    access: 'products.import',
    run: (rt) => ({ filename: `catalogue-${businessDate(rt.now())}.csv`, mime: 'text/csv', text: catalogueIo.exportCatalogueCsv(rt.db) }),
  },
  'catalogue:importPreview': { access: 'products.import', schema: z.object({ text: z.string().max(5_000_000) }), run: (rt, i) => catalogueIo.previewCatalogueCsv(rt.db, i.text) },
  'catalogue:importCommit': { access: 'products.import', schema: z.object({ text: z.string().max(5_000_000), acceptWarnings: z.boolean() }), run: (_rt, i, ctx) => catalogueIo.commitCatalogueCsv(ctx!, i.text, { acceptWarnings: i.acceptWarnings }) },

  // ------------------------------------------------------------ inventory
  'inventory:movements': { access: 'inventory.view', schema: z.object({ productId: z.number().int().optional(), type: z.string().max(30).optional(), ...dateRange.shape, ...page }), run: (rt, i) => inventory.listMovements(rt.db, i) },
  'inventory:adjust': { access: 'inventory.adjust', schema: inventory.adjustSchema, run: (_rt, i, ctx) => inventory.adjustStock(ctx!, i) },
  'inventory:setOpening': { access: 'inventory.adjust', schema: z.object({ rows: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().int().min(0) })).min(1).max(2000) }), run: (_rt, i, ctx) => inventory.setOpeningBalances(ctx!, i.rows) },
  'inventory:previewStockCsv': { access: 'inventory.adjust', schema: z.object({ text: z.string().max(5_000_000) }), run: (rt, i) => inventory.previewStockCsv(rt.db, i.text) },
  'inventory:valuation': { access: ['inventory.adjust', 'reports.view'], run: (rt) => inventory.stockValuation(rt.db) },
  'inventory:reconcile': { access: 'inventory.view', schema: z.object({ date: z.string().refine(isDateString) }), run: (rt, i) => inventory.reconcileDay(rt.db, i.date) },
  'inventory:count': { access: 'inventory.adjust', schema: z.object({ date: z.string().refine(isDateString), counts: z.array(z.object({ productId: z.number().int().positive(), countedQty: z.number().int().min(0) })).min(1).max(2000) }), run: (_rt, i, ctx) => inventory.recordStockCount(ctx!, i) },
  'inventory:lowStock': { access: 'inventory.view', run: (rt) => inventory.lowStock(rt.db, 500) },

  // ------------------------------------------------------------ purchasing
  'suppliers:list': { access: 'purchases.manage', run: (rt) => purchases.listSuppliers(rt.db) },
  'suppliers:save': { access: 'purchases.manage', schema: z.object({ id: z.number().int().positive().nullable(), data: purchases.supplierSchema }), run: (_rt, i, ctx) => purchases.saveSupplier(ctx!, i.id, i.data) },
  'purchases:list': { access: 'purchases.manage', schema: z.object({ ...dateRange.shape, supplierId: z.number().int().optional(), ...page }), run: (rt, i) => purchases.listPurchases(rt.db, i) },
  'purchases:get': { access: 'purchases.manage', schema: id, run: (rt, i) => purchases.getPurchase(rt.db, i.id) },
  'purchases:create': { access: 'purchases.manage', schema: purchases.purchaseSchema, run: (_rt, i, ctx) => purchases.createPurchase(ctx!, i) },

  // --------------------------------------------------------------- billing
  'billing:create': { access: 'billing.create', schema: billing.createInvoiceSchema, run: (_rt, i, ctx) => billing.createInvoice(ctx!, i) },
  'invoice:html': {
    access: 'billing.reprint',
    schema: z.object({ id: z.number().int().positive(), size: z.enum(['58mm', '80mm', 'a4']).optional() }),
    run: (rt, i, ctx) => ({ html: buildInvoiceHtml(rt, ctx!, i.id, i.size, './fonts') }),
  },
  'sales:list': {
    access: 'sales.view',
    schema: z.object({ ...dateRange.shape, invoiceNo: z.string().max(40).optional(), productId: z.number().int().optional(), cashierId: z.number().int().optional(), paymentMode: z.enum(['cash', 'upi', 'card']).optional(), customer: z.string().max(80).optional(), status: z.enum(['completed', 'cancelled']).optional(), ...page }),
    run: (rt, i) => billing.listInvoices(rt.db, i),
  },
  'sales:get': { access: 'sales.view', schema: id, run: (rt, i) => billing.getInvoice(rt.db, i.id) },
  'sales:findByNo': { access: 'sales.view', schema: z.object({ invoiceNo: z.string().min(1).max(40) }), run: (rt, i) => billing.findInvoiceByNo(rt.db, i.invoiceNo) },
  'sales:cancel': { access: 'authed', schema: billing.cancelSchema, run: (_rt, i, ctx) => billing.cancelInvoice(ctx!, i) },
  'sales:collectDue': { access: 'sales.collect_due', schema: billing.collectDueSchema, run: (_rt, i, ctx) => billing.collectDue(ctx!, i) },
  'returns:create': { access: 'authed', schema: returns.returnSchema, run: (_rt, i, ctx) => returns.createReturn(ctx!, i) },
  'returns:list': { access: 'sales.view', schema: z.object({ ...dateRange.shape, invoiceId: z.number().int().optional(), ...page }), run: (rt, i) => returns.listReturns(rt.db, i) },

  // ------------------------------------------------------------- customers
  'customers:list': { access: ['customers.manage', 'billing.create'], schema: z.object({ search: z.string().max(80).optional(), ...page }), run: (rt, i) => customers.listCustomers(rt.db, i) },
  'customers:save': { access: 'customers.manage', schema: z.object({ id: z.number().int().positive().nullable(), data: customers.customerSchema }), run: (_rt, i, ctx) => customers.saveCustomer(ctx!, i.id, i.data) },

  // -------------------------------------------------------------- reports
  'dashboard:get': { access: 'reports.view', schema: z.object({ date: z.string().refine(isDateString).optional() }), run: (rt, i) => reports.dashboard(rt.db, i.date ?? businessDate(rt.now())) },
  'reports:run': { access: 'reports.view', schema: reports.reportParamsSchema, run: (rt, i) => reports.runReport(rt.db, i) },
  'reports:export': {
    access: 'reports.view',
    schema: reports.reportParamsSchema.extend({ format: z.enum(['csv', 'xlsx']) }),
    run: (rt, { format, ...p }) => {
      const t = reports.runReport(rt.db, p);
      const base = `${p.name}-${p.from}-to-${p.to}`;
      if (format === 'csv') return { filename: `${base}.csv`, mime: 'text/csv', text: toCsv(reports.reportToGrid(t, 'csv')) };
      return { filename: `${base}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: Buffer.from(toXlsx(t.title, reports.reportToGrid(t, 'xlsx'))).toString('base64') };
    },
  },
  'expenses:list': { access: 'expenses.manage', schema: z.object({ ...dateRange.shape, includeVoided: z.boolean().optional() }), run: (rt, i) => expenses.listExpenses(rt.db, i) },
  'expenses:create': { access: 'expenses.manage', schema: expenses.expenseSchema, run: (_rt, i, ctx) => expenses.createExpense(ctx!, i) },
  'expenses:void': { access: 'expenses.manage', schema: z.object({ id: z.number().int().positive(), reason: z.string().min(3).max(300) }), run: (_rt, i, ctx) => { expenses.voidExpense(ctx!, i.id, i.reason); return true; } },

  // ------------------------------------------------------- users and audit
  'users:list': { access: 'users.manage', run: (rt) => users.listUsers(rt.db) },
  'roles:list': { access: ['users.manage', 'settings.manage'], run: (rt) => users.listRoles(rt.db) },
  'users:create': { access: 'users.manage', schema: users.userCreateSchema, run: (_rt, i, ctx) => users.createUser(ctx!, i) },
  'users:update': { access: 'users.manage', schema: z.object({ id: z.number().int().positive(), data: users.userUpdateSchema, confirmPassword: z.string() }), run: (_rt, i, ctx) => users.updateUser(ctx!, i.id, i.data, i.confirmPassword) },
  'roles:setPermissions': { access: 'users.manage', schema: z.object({ roleId: z.number().int().positive(), permissions: z.array(z.string()).max(60), confirmPassword: z.string() }), run: (_rt, i, ctx) => users.setRolePermissions(ctx!, i.roleId, i.permissions, i.confirmPassword) },
  'audit:list': { access: 'audit.view', schema: z.object({ action: z.string().max(60).optional(), search: z.string().max(80).optional(), ...page }), run: (rt, i) => listAudit(rt.db, i) },

  // --------------------------------------------------------------- backups
  'backup:list': { access: 'backup.manage', run: (rt) => ({ dir: rt.backupDir(), backups: backup.listBackups(rt.backupDir()) }) },
  'backup:createTo': {
    access: 'backup.manage',
    schema: z.object({ dir: z.string().min(1).max(1000).nullable() }),
    run: async (rt, i, ctx) => {
      const info = await rt.backupNow(i.dir, 'manual');
      audit(ctx!, { action: 'backup.manual', entity: 'backup', details: { file: info.file } });
      return info;
    },
  },
  'backup:inspect': { access: 'backup.manage', schema: z.object({ file: z.string().min(1).max(1000) }), run: (_rt, i) => backup.inspectBackup(i.file) },
  'backup:integrity': { access: 'backup.manage', run: (rt) => backup.integrityCheck(rt.db) },
  'backup:restore': {
    access: 'backup.manage',
    schema: z.object({ file: z.string().min(1).max(1000), confirmPassword: z.string() }),
    run: async (rt, i, ctx) => {
      auth.confirmOwnPassword(ctx!, i.confirmPassword);
      const r = await rt.restore(i.file, ctx!.user.username);
      return { ...r, signedOut: true };
    },
  },

  // ------------------------------------------------------ small utilities
  'util:csvTemplate': {
    access: 'products.import',
    run: () => ({ filename: 'catalogue-template.csv', mime: 'text/csv', text: toCsv([['sku', 'barcode', 'name_en', 'name_ta', 'category', 'unit', 'price', 'cost', 'min_stock', 'discount_rule', 'active', 'notes'], ['', '', 'Example Product', 'எடுத்துக்காட்டு', 'Fancy Items', 'Box', '100.00', '', '0', 'inherit', 'yes', '']]) }),
  },
};

/** Record that an invoice was sent to the printer or saved as PDF (drives the DUPLICATE COPY marker on reprints). */
export function recordInvoicePrint(ctx: Ctx, invoiceId: number, mode: 'print' | 'pdf'): void {
  audit(ctx, { action: 'invoice.print', entity: 'invoices', entityId: invoiceId, details: { mode } });
}

export const CHANNELS = Object.keys(HANDLERS);
export const isKnownChannel = (c: string): boolean => Object.prototype.hasOwnProperty.call(HANDLERS, c);

function authorize(user: SessionUser | null, access: Access): void {
  if (access === 'public') return;
  if (!user) throw new AppError('UNAUTHENTICATED', 'Please sign in');
  if (access === 'authed') return;
  const need = Array.isArray(access) ? access : [access];
  if (!need.some((p) => user.permissions.includes(p))) throw new AppError('FORBIDDEN', 'You do not have permission to do this', { permission: need });
}

function toError(e: unknown): ApiResult<never> {
  if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
  if (e instanceof RangeError) return { ok: false, error: { code: 'VALIDATION', message: e.message } };
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return { ok: false, error: { code: 'VALIDATION', message: i ? `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}` : 'Invalid input' } };
  }
  if (e instanceof Error && /FOREIGN KEY|CHECK constraint|NOT NULL constraint/.test(e.message)) {
    return { ok: false, error: { code: 'VALIDATION', message: `The data was rejected by database rules (${e.message}).` } };
  }
  if (e instanceof Error && /SQLITE_BUSY|database is locked/i.test(e.message)) {
    return { ok: false, error: { code: 'CONFLICT', message: 'The database is busy. Please try again in a moment.' } };
  }
  console.error('[api] unexpected error', e);
  return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. The operation was not completed.' } };
}

/**
 * The only entry point from the renderer. Authenticates, authorises against the permissions stored in the
 * database, validates the payload with Zod and runs the handler - no UI-side checks are trusted.
 */
export async function dispatch(rt: Runtime, channel: string, payload: unknown): Promise<ApiResult> {
  try {
    const h = HANDLERS[channel];
    if (!h || !Object.prototype.hasOwnProperty.call(HANDLERS, channel)) throw new AppError('NOT_FOUND', 'Unknown operation');
    const user = rt.user();
    authorize(user, h.access);
    const input = h.schema ? h.schema.parse(payload ?? {}) : payload;
    const ctx = user ? { db: rt.db, user, now: rt.now } : null;
    const data = await h.run(rt, input, ctx);
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export { csvToObjects, parseCsv };
