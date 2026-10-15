import { app, BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Runtime } from '../core/runtime';
import { AppError } from '../core/errors';
import { buildInvoiceHtml, buildLabelsHtml, labelsRequestSchema, recordInvoicePrint, recordLabelPrint, shopForPrint } from '../core/api';
import { LATEST_SCHEMA_VERSION } from '../core/db/schema';
import { currentSchemaVersion } from '../core/db/connection';
import { getSetting } from '../core/settings';
import { renderInvoiceHtml, sampleInvoice, PAPER_WIDTH_MICRONS, type ReceiptSize } from '../shared/invoiceHtml';
import { backupsDir, dataRoot, dbFile, tempDir } from './paths';
import { log } from './logger';

type Result = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } };
const ok = (data: unknown): Result => ({ ok: true, data });
const err = (code: string, message: string): Result => ({ ok: false, error: { code, message } });

export interface NativeState {
  getWindow: () => BrowserWindow | null;
  lastBackupError: string | null;
  /** Folder that contains index.html (so fonts resolve for print windows). */
  rendererRoot: string;
}

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function requireSignedIn(rt: Runtime): void {
  if (!rt.user()) throw new AppError('UNAUTHENTICATED', 'Please sign in');
}

const filtersSchema = z.array(z.object({ name: z.string().max(40), extensions: z.array(z.string().regex(/^[A-Za-z0-9]{1,8}$/)).max(6) })).max(4).optional();

/** Print a standalone HTML document through a hidden, sandboxed window. */
type PrintPage =
  | { kind: 'receipt'; size: ReceiptSize }
  /** Exact page size in micrometres, zero margins (barcode labels: position matters). */
  | { kind: 'exact'; widthMicrons: number; heightMicrons: number }
  /** A4 with zero margins; the document positions everything itself (A4 sticker sheets). */
  | { kind: 'a4-exact' };

export interface PrintTarget {
  /** System printer name; undefined = use the system print window. */
  deviceName?: string;
  /** Print without showing the system dialog (only when deviceName is set). */
  silent: boolean;
  copies: number;
}

export interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  /** CUPS printer-state when reported: 3 idle, 4 printing, 5 stopped. 0 when the platform does not say. */
  status: number;
}

async function listPrinters(state: NativeState): Promise<PrinterInfo[]> {
  const wc = state.getWindow()?.webContents;
  if (!wc) return [];
  const list = await wc.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, description: p.description ?? '', isDefault: String((p.options as Record<string, unknown> | undefined)?.['is-default']) === 'true', status: Number((p.options as Record<string, unknown> | undefined)?.['printer-state'] ?? 0) || 0 }));
}

/**
 * Work out where a document should be printed. A chosen printer that no longer exists (unplugged, renamed, driver
 * removed) falls back to the system print window and says so, rather than failing at the counter.
 */
async function resolveTarget(rt: Runtime, state: NativeState, kind: 'receipt' | 'label'): Promise<PrintTarget & { note?: string }> {
  const chosen = getSetting(rt.db, kind === 'receipt' ? 'printing.receipt_printer' : 'printing.label_printer');
  const copies = kind === 'receipt' ? getSetting(rt.db, 'printing.receipt_copies') : 1;
  if (!chosen) return { silent: false, copies };
  const printers = await listPrinters(state);
  if (!printers.some((p) => p.name === chosen)) return { silent: false, copies, note: `Printer "${chosen}" was not found, so the print window was used. Check the printer or change it in Settings → Printers.` };
  return { deviceName: chosen, silent: getSetting(rt.db, 'printing.silent'), copies };
}

async function printHtml(state: NativeState, html: string, page: PrintPage | ReceiptSize, mode: 'print' | 'pdf', suggestedName: string, target: PrintTarget & { note?: string } = { silent: false, copies: 1 }): Promise<Result> {
  const pg: PrintPage = typeof page === 'string' ? { kind: 'receipt', size: page } : page;
  const a4 = (pg.kind === 'receipt' && pg.size === 'a4') || pg.kind === 'a4-exact';
  const zeroMargins = pg.kind !== 'receipt' || pg.size !== 'a4';
  mkdirSync(tempDir(), { recursive: true });
  const file = join(tempDir(), `print-${process.pid}-${Date.now()}.html`);
  writeFileSync(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, webSecurity: true },
  });
  try {
    await win.loadFile(file);
    const wc: WebContents = win.webContents;
    await wc.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true');
    const pageSize =
      pg.kind === 'exact'
        ? { width: pg.widthMicrons, height: pg.heightMicrons }
        : a4
          ? ('A4' as const)
          : {
              width: PAPER_WIDTH_MICRONS[(pg as { size: ReceiptSize }).size],
              // measured content height (CSS px -> microns at 96 dpi) plus a small trailing margin
              height: Math.max(40000, Math.ceil(((await wc.executeJavaScript('document.documentElement.scrollHeight')) as number) * 264.583) + 8000),
            };
    if (mode === 'pdf') {
      // printToPDF takes custom sizes in inches; webContents.print takes microns.
      const pdfSize = typeof pageSize === 'string' ? pageSize : { width: pageSize.width / 25400, height: pageSize.height / 25400 };
      const data = await wc.printToPDF({ pageSize: pdfSize, printBackground: true, margins: zeroMargins ? { top: 0, bottom: 0, left: 0, right: 0 } : undefined, preferCSSPageSize: pg.kind !== 'receipt' });
      const parent = state.getWindow();
      const opts = { defaultPath: suggestedName, filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return ok({ saved: false });
      writeFileSync(res.filePath, data);
      return ok({ saved: true, path: res.filePath });
    }
    return await new Promise<Result>((resolve) => {
      wc.print({ silent: target.silent && !!target.deviceName, deviceName: target.deviceName, copies: target.copies, printBackground: true, pageSize, margins: zeroMargins ? { marginType: 'none' } : undefined }, (success, reason) => {
        if (success) resolve(ok({ printed: true, printer: target.deviceName ?? null, silent: target.silent && !!target.deviceName, note: target.note ?? null }));
        else if (/cancel/i.test(reason ?? '')) resolve(ok({ printed: false, cancelled: true }));
        else resolve(err('INTERNAL', `Printing failed: ${reason || 'unknown reason'}. Check that a printer is installed and online, or use Save as PDF.`));
      });
    });
  } finally {
    win.destroy();
    rmSync(file, { force: true });
  }
}

const printSchema = z.object({ id: z.number().int().positive(), size: z.enum(['58mm', '80mm', 'a4']).optional(), mode: z.enum(['print', 'pdf']) });

export async function handleNative(rt: Runtime, state: NativeState, channel: string, payload: unknown): Promise<Result> {
  try {
    switch (channel) {
      case 'app:info': {
        requireSignedIn(rt);
        return ok({
          name: app.getName(),
          version: app.getVersion(),
          platform: process.platform,
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          dataDir: dataRoot(),
          dbPath: dbFile(),
          backupDir: backupsDir(),
          schemaVersion: currentSchemaVersion(rt.db),
          latestSchemaVersion: LATEST_SCHEMA_VERSION,
          lastBackupError: state.lastBackupError,
        });
      }
      case 'app:showDataFolder': {
        requireSignedIn(rt);
        const u = rt.requireUser();
        if (!u.permissions.includes('backup.manage')) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
        const msg = await shell.openPath(dataRoot());
        return msg ? err('INTERNAL', msg) : ok(true);
      }
      case 'dialog:saveFile': {
        requireSignedIn(rt);
        const p = z.object({ defaultName: z.string().min(1).max(120).regex(/^[^\\/:*?"<>|]+$/), text: z.string().max(20_000_000).optional(), base64: z.string().max(30_000_000).optional(), filters: filtersSchema }).parse(payload);
        const parent = state.getWindow();
        const opts = { defaultPath: join(app.getPath('documents'), p.defaultName), filters: p.filters };
        const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
        if (res.canceled || !res.filePath) return ok({ saved: false });
        writeFileSync(res.filePath, p.base64 !== undefined ? Buffer.from(p.base64, 'base64') : (p.text ?? ''), p.base64 !== undefined ? undefined : 'utf8');
        return ok({ saved: true, path: res.filePath });
      }
      case 'dialog:openText': {
        requireSignedIn(rt);
        const p = z.object({ filters: filtersSchema }).parse(payload ?? {});
        const parent = state.getWindow();
        const opts = { properties: ['openFile' as const], filters: p.filters };
        const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
        if (res.canceled || !res.filePaths[0]) return ok(null);
        const path = res.filePaths[0];
        if (statSync(path).size > MAX_TEXT_BYTES) return err('VALIDATION', 'That file is too large to import (limit 5 MB).');
        return ok({ path, name: path.split(/[\\/]/).pop(), text: readFileSync(path, 'utf8') });
      }
      case 'dialog:chooseFolder': {
        requireSignedIn(rt);
        const parent = state.getWindow();
        const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] };
        const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
        return ok(res.canceled || !res.filePaths[0] ? null : res.filePaths[0]);
      }
      case 'dialog:chooseBackupFile': {
        requireSignedIn(rt);
        const parent = state.getWindow();
        const opts = { properties: ['openFile' as const], defaultPath: rt.backupDir(), filters: [{ name: 'Sri Krishna Billing backup', extensions: ['sqlite'] }] };
        const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
        return ok(res.canceled || !res.filePaths[0] ? null : res.filePaths[0]);
      }
      case 'print:invoice': {
        const u = rt.requireUser();
        if (!u.permissions.includes('billing.reprint')) throw new AppError('FORBIDDEN', 'You do not have permission to print invoices');
        const p = printSchema.parse(payload);
        const fontBase = pathToFileURL(join(state.rendererRoot, 'fonts')).toString();
        const size = p.size ?? getSetting(rt.db, 'invoice.receipt_size');
        const html = buildInvoiceHtml(rt, rt.ctx(), p.id, size, fontBase);
        const inv = rt.db.prepare('SELECT invoice_no FROM invoices WHERE id = ?').get(p.id) as { invoice_no: string };
        const res = await printHtml(state, html, size, p.mode, `${inv.invoice_no}.pdf`, p.mode === 'print' ? await resolveTarget(rt, state, 'receipt') : undefined);
        if (res.ok) {
          const d = res.data as { printed?: boolean; saved?: boolean };
          if (d.printed || d.saved) recordInvoicePrint(rt.ctx(), p.id, p.mode);
        }
        return res;
      }
      case 'printers:list': {
        const u = rt.requireUser();
        if (!['billing.reprint', 'settings.manage', 'products.view'].some((x) => u.permissions.includes(x as never))) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
        return ok(await listPrinters(state));
      }
      case 'print:labels': {
        const u = rt.requireUser();
        if (!u.permissions.includes('products.view')) throw new AppError('FORBIDDEN', 'You do not have permission to print labels');
        const p = labelsRequestSchema.extend({ mode: z.enum(['print', 'pdf']) }).parse(payload);
        const fontBase = pathToFileURL(join(state.rendererRoot, 'fonts')).toString();
        const built = buildLabelsHtml(rt, p, fontBase);
        if (built.labels === 0) return err('VALIDATION', 'None of the selected products has a printable barcode.');
        const g = built.geometry;
        const page: PrintPage = p.layout?.kind === 'a4' || (!p.layout && getSetting(rt.db, 'labels.layout').kind === 'a4') ? { kind: 'a4-exact' } : { kind: 'exact', widthMicrons: Math.round(g.pageWidthMm * 1000), heightMicrons: Math.round(g.pageHeightMm * 1000) };
        const res = await printHtml(state, built.html, page, p.mode, 'barcode-labels.pdf', p.mode === 'print' ? await resolveTarget(rt, state, 'label') : undefined);
        if (res.ok) {
          const d = res.data as { printed?: boolean; saved?: boolean };
          if (d.printed || d.saved) recordLabelPrint(rt.ctx(), built.labels, p.mode);
        }
        return res;
      }
      case 'print:test': {
        const u = rt.requireUser();
        if (!u.permissions.includes('settings.manage')) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
        const p = z.object({ size: z.enum(['58mm', '80mm', 'a4']), mode: z.enum(['print', 'pdf']) }).parse(payload);
        const target = p.mode === 'print' ? await resolveTarget(rt, state, 'receipt') : undefined;
        const fontBase = pathToFileURL(join(state.rendererRoot, 'fonts')).toString();
        const html = renderInvoiceHtml(sampleInvoice(), shopForPrint(rt), { size: p.size, fontBase });
        return await printHtml(state, html, p.size, p.mode, 'test-print.pdf', target);
      }
      default:
        return err('NOT_FOUND', 'Unknown operation');
    }
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
    if (e instanceof z.ZodError) return err('VALIDATION', e.issues[0]?.message ?? 'Invalid input');
    log.error('native handler failed', channel, e);
    return err('INTERNAL', 'Something went wrong. The operation was not completed.');
  }
}
