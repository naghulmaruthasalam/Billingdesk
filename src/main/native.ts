import { app, BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { bgraToGray, encodeReceipt, THERMAL_PAPER, type GrayRaster } from '../core/escpos';
import { encodeTspl, encodeZpl, rotate180 } from '../core/labelprint';
import { resolveReceiptMethod, resolveLabelMethod, type ReceiptMethod, type LabelMethod } from '../shared/printers';
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

/**
 * After a job is handed to CUPS, ask the queue whether the printer is actually accepting work. A stopped/disabled queue
 * (unplugged USB printer, no permission to the device, ...) otherwise swallows the job silently. Returns a warning to show
 * the user, or undefined when everything looks fine or the system has no `lpstat`.
 */
async function queueWarning(printer: string): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined;
  await new Promise((r) => setTimeout(r, 1500));
  return await new Promise<string | undefined>((resolve) => {
    execFile('lpstat', ['-p', printer], { timeout: 5000 }, (e, out) => {
      if (e) return resolve(undefined);
      const text = String(out).trim();
      if (/disabled|stopped|not accepting/i.test(text)) resolve(`The job was queued but the printer "${printer}" reports a problem: ${text.split('\n')[0]}. Check that it is switched on, connected by USB and has paper, then re-enable it (Linux: cupsenable ${printer}).`);
      else resolve(undefined);
    });
  });
}

/** Print a standalone HTML document through a hidden, sandboxed window. */
/**
 * Thermal receipt printing without a driver: draw the receipt page into a 1-bit image at the printer's native width and
 * send it as ESC/POS raster commands through a raw print queue (`lp -o raw`). Works with queues that have no driver or only
 * a text-only driver. Not available on Windows (use the driver there).
 */
async function printEscPos(_state: NativeState, html: string, size: '58mm' | '80mm', target: PrintTarget & { note?: string }, cut: boolean): Promise<Result> {
  if (process.platform === 'win32') return err('VALIDATION', 'Thermal (ESC/POS) mode is available on Linux. On Windows install the printer driver and use the "driver" method.');
  const { dots, printableMm } = THERMAL_PAPER[size];
  const cssWidth = (printableMm * 96) / 25.4;
  const zoom = dots / cssWidth; // zoom so the layout is rendered directly at 1 CSS px = 1/zoom dots: crisp, not up-scaled
  mkdirSync(tempDir(), { recursive: true });
  const stamp = `${process.pid}-${Date.now()}`;
  const htmlFile = join(tempDir(), `escpos-${stamp}.html`);
  const binFile = join(tempDir(), `escpos-${stamp}.bin`);
  writeFileSync(htmlFile, html, 'utf8');
  const win = new BrowserWindow({ show: false, width: dots, height: 600, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, zoomFactor: zoom } });
  win.webContents.on('render-process-gone', (_e, d) => log.error('receipt renderer gone', d));
  try {
    win.webContents.setFrameRate(5);
    await win.loadFile(htmlFile);
    win.webContents.setZoomFactor(zoom);
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true');
    await new Promise((r) => setTimeout(r, 300));
    const cssHeight = (await win.webContents.executeJavaScript('Math.ceil(document.body.getBoundingClientRect().height + 8)')) as number;
    const height = Math.max(40, Math.ceil(cssHeight * zoom));
    win.setContentSize(dots, height);
    await new Promise((r) => setTimeout(r, 800)); // let the offscreen surface repaint at the new size
    const img = await win.webContents.capturePage();
    const sz = img.getSize();
    if (sz.width !== dots || sz.height < 40) throw new Error(`Receipt image has an unexpected size ${sz.width}x${sz.height}`);
    const raster = bgraToGray(img.toBitmap(), sz.width, sz.height);
    writeFileSync(binFile, encodeReceipt(raster, { cut, copies: target.copies }));
    await new Promise<void>((resolve, reject) => {
      // Fixed argument list, no shell; the printer name was matched against the installed printers.
      execFile('lp', ['-d', target.deviceName!, '-o', 'raw', '-t', 'Receipt', binFile], { timeout: 20000 }, (e, _out, stderr) => {
        if (e) reject(new Error((stderr || e.message).trim()));
        else resolve();
      });
    });
    const warn = await queueWarning(target.deviceName!);
    return ok({ printed: true, printer: target.deviceName ?? null, silent: true, method: 'escpos', note: [target.note, warn].filter(Boolean).join(' ') || null });
  } catch (e) {
    log.error('ESC/POS print failed', e);
    return err('INTERNAL', `Printing failed: ${e instanceof Error ? e.message : String(e)}. Check that the printer is on, has paper and is selected in Settings → Printers.`);
  } finally {
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
      rmSync(htmlFile, { force: true });
      rmSync(binFile, { force: true });
    }, 4000);
  }
}

/**
 * Draw the label rows (one printed row of the roll per image) in an offscreen window at the printer's resolution. The label
 * HTML stacks the rows vertically; each row is brought into view by scrolling and captured.
 */
async function renderLabelRows(html: string, geo: { pageWidthMm: number; labelHeightMm: number }, count: number, dpi: number): Promise<GrayRaster[]> {
  const dpmm = dpi / 25.4;
  const wDots = Math.round(geo.pageWidthMm * dpmm);
  const hDots = Math.round(geo.labelHeightMm * dpmm);
  const zoom = dpi / 96;
  const cssRowH = (geo.labelHeightMm * 96) / 25.4;
  mkdirSync(tempDir(), { recursive: true });
  const stamp = `${process.pid}-${Date.now()}`;
  const htmlFile = join(tempDir(), `labels-${stamp}.html`);
  writeFileSync(htmlFile, html, 'utf8');
  const win = new BrowserWindow({ show: false, width: wDots, height: hDots, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, zoomFactor: zoom } });
  win.webContents.on('render-process-gone', (_e, d) => log.error('label renderer gone', d));
  try {
    win.webContents.setFrameRate(5);
    await win.loadFile(htmlFile);
    win.webContents.setZoomFactor(zoom);
    await win.webContents.insertCSS('.lb:not(.rw .lb){margin:0 !important;box-shadow:none !important}.rw{margin:0 !important;box-shadow:none !important}.rw .lb{outline:none !important}html,body{background:#fff !important;overflow:hidden}');
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true');
    win.setContentSize(wDots, hDots);
    await new Promise((res) => setTimeout(res, 600));
    const rows: GrayRaster[] = [];
    for (let i = 0; i < count; i++) {
      await win.webContents.executeJavaScript(`window.scrollTo(0, ${i * cssRowH})`);
      await new Promise((res) => setTimeout(res, 160));
      const img = await win.webContents.capturePage();
      const sz = img.getSize();
      if (sz.width !== wDots || sz.height < hDots) throw new Error(`Label image has an unexpected size ${sz.width}x${sz.height}`);
      const gray = bgraToGray(img.toBitmap(), sz.width, sz.height);
      rows.push({ width: wDots, height: hDots, gray: gray.gray.subarray(0, wDots * hDots) });
    }
    return rows;
  } finally {
    win.destroy();
    rmSync(htmlFile, { force: true });
  }
}

type RawLabelMethod = 'escpos' | 'tspl' | 'zpl';

/**
 * Barcode labels without a printer driver, through a raw CUPS queue (`lp -o raw`): ESC/POS for thermal receipt printers (rows
 * centred on the paper, cut between labels), TSPL or ZPL for dedicated label printers (TVS LP 46, TSC, Zebra ...).
 */
async function printRawLabels(method: RawLabelMethod, html: string, g: { pageWidthMm: number; labelHeightMm: number }, rowCount: number, ctx: { dpi: number; paper: '58mm' | '80mm'; rowGapMm: number; cut: boolean; rotate: boolean; invert: boolean }, target: PrintTarget & { note?: string }): Promise<Result> {
  if (process.platform === 'win32') return err('VALIDATION', 'Raw label printing is available on Linux. On Windows install the printer driver and use the "driver" method.');
  const dpmm = ctx.dpi / 25.4;
  if (method === 'escpos') {
    const { dots, printableMm } = THERMAL_PAPER[ctx.paper];
    if (Math.round(g.pageWidthMm * dpmm) > dots) return err('VALIDATION', `The label row is ${Math.round(g.pageWidthMm)} mm wide but the ${ctx.paper} paper prints at most ${printableMm} mm. Choose a narrower label in Products → Barcode labels, or use a label printer.`);
  }
  mkdirSync(tempDir(), { recursive: true });
  const binFile = join(tempDir(), `labels-${process.pid}-${Date.now()}.bin`);
  try {
    let rows = await renderLabelRows(html, { pageWidthMm: g.pageWidthMm, labelHeightMm: g.labelHeightMm }, rowCount, ctx.dpi);
    if (ctx.rotate) rows = rows.map(rotate180);
    let payload: Buffer;
    if (method === 'escpos') {
      const { dots } = THERMAL_PAPER[ctx.paper];
      const w = rows[0].width;
      const left = (dots - w) >> 1;
      payload = Buffer.concat(
        rows.map((r) => {
          const page = new Uint8Array(dots * r.height).fill(255); // white, label row centred on the paper
          for (let y = 0; y < r.height; y++) page.set(r.gray.subarray(y * w, (y + 1) * w), y * dots + left);
          return encodeReceipt({ width: dots, height: r.height, gray: page }, { cut: ctx.cut, copies: 1, feedLines: 2 });
        }),
      );
    } else {
      const job = { rows, widthMm: g.pageWidthMm, heightMm: g.labelHeightMm, gapMm: ctx.rowGapMm, invert: ctx.invert };
      payload = method === 'tspl' ? encodeTspl(job) : encodeZpl(job, dpmm);
    }
    writeFileSync(binFile, payload);
    await new Promise<void>((resolve, reject) => {
      execFile('lp', ['-d', target.deviceName!, '-o', 'raw', '-t', 'Labels', binFile], { timeout: 60000 }, (e, _out, stderr) => {
        if (e) reject(new Error((stderr || e.message).trim()));
        else resolve();
      });
    });
    const warn = await queueWarning(target.deviceName!);
    return ok({ printed: true, printer: target.deviceName ?? null, silent: true, method, note: [target.note, warn].filter(Boolean).join(' ') || null });
  } catch (e) {
    log.error('raw label print failed', e);
    return err('INTERNAL', `Printing labels failed: ${e instanceof Error ? e.message : String(e)}. Check that the printer is on, has labels loaded and is selected in Settings → Printers.`);
  } finally {
    setTimeout(() => rmSync(binFile, { force: true }), 4000);
  }
}

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
  /** Driver description reported by the print system, e.g. "Generic text-only printer". */
  model: string;
  /** CUPS printer-state when reported: 3 idle, 4 printing, 5 stopped. 0 when the platform does not say. */
  status: number;
}

async function listPrinters(state: NativeState): Promise<PrinterInfo[]> {
  const wc = state.getWindow()?.webContents;
  if (!wc) return [];
  const list = await wc.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, description: p.description ?? '', model: String((p.options as Record<string, unknown> | undefined)?.['printer-make-and-model'] ?? ''), isDefault: String((p.options as Record<string, unknown> | undefined)?.['is-default']) === 'true', status: Number((p.options as Record<string, unknown> | undefined)?.['printer-state'] ?? 0) || 0 }));
}

/**
 * Work out which printer receives a document. The operating system's print dialog is never used: it has to be opened by
 * Chromium from a hidden window, which is unreliable on Linux. Instead the app always prints directly to a named printer:
 * the one the user picked for this print, else the saved one, else the system default (else the first installed).
 */
/** Decide whether a receipt goes through the printer driver or as ESC/POS commands ('auto' looks at the chosen printer). */
async function receiptMethodFor(rt: Runtime, state: NativeState, target: PrintTarget | undefined): Promise<'driver' | 'escpos'> {
  const method = getSetting(rt.db, 'printing.receipt_method') as ReceiptMethod;
  if (method !== 'auto') return method;
  const printer = (await listPrinters(state)).find((p) => p.name === target?.deviceName);
  return resolveReceiptMethod(method, printer, process.platform);
}

/** Decide how labels reach the chosen printer: driver, ESC/POS (receipt printers), TSPL or ZPL (label printers). */
async function labelMethodFor(rt: Runtime, state: NativeState, target: PrintTarget | undefined): Promise<'driver' | 'escpos' | 'tspl' | 'zpl'> {
  const printer = (await listPrinters(state)).find((p) => p.name === target?.deviceName);
  return resolveLabelMethod(getSetting(rt.db, 'printing.label_method') as LabelMethod, printer, process.platform);
}

async function resolveTarget(rt: Runtime, state: NativeState, kind: 'receipt' | 'label', override?: string): Promise<PrintTarget & { note?: string }> {
  const saved = getSetting(rt.db, kind === 'receipt' ? 'printing.receipt_printer' : 'printing.label_printer');
  const copies = kind === 'receipt' ? getSetting(rt.db, 'printing.receipt_copies') : 1;
  const printers = await listPrinters(state);
  if (printers.length === 0) {
    throw new AppError('VALIDATION', 'No printer is installed on this computer. Add the printer in the system settings (Linux: Settings → Printers or http://localhost:631) and press Refresh in Settings → Printers - or use Save as PDF.');
  }
  const want = override || saved;
  const found = printers.find((p) => p.name === want);
  const chosen = found ?? printers.find((p) => p.isDefault) ?? printers[0];
  const note = want && !found ? `Printer "${want}" was not found, so ${chosen.displayName} was used. Check the printer or change it in Settings → Printers.` : undefined;
  return { deviceName: chosen.name, silent: true, copies, note };
}

async function printHtml(state: NativeState, html: string, page: PrintPage | ReceiptSize, mode: 'print' | 'pdf', suggestedName: string, target: PrintTarget & { note?: string } = { silent: true, copies: 1 }): Promise<Result> {
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
  win.webContents.on('render-process-gone', (_e, d) => log.error('print window renderer gone', d));
  let keepAlive = false;
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
      wc.print({ silent: true, deviceName: target.deviceName, copies: target.copies, printBackground: true, pageSize, margins: zeroMargins ? { marginType: 'none' } : undefined }, (success, reason) => {
        if (success) void (target.deviceName ? queueWarning(target.deviceName) : Promise.resolve(undefined)).then((warn) => resolve(ok({ printed: true, printer: target.deviceName ?? null, silent: true, note: [target.note, warn].filter(Boolean).join(' ') || null })));
        else if (/cancel/i.test(reason ?? '')) resolve(ok({ printed: false, cancelled: true }));
        else resolve(err('INTERNAL', `Printing failed: ${reason || 'unknown reason'}. Check that a printer is installed and online, or use Save as PDF.`));
      });
    });
  } finally {
    // After handing a job to the spooler, give the print system a moment before tearing the window down (destroying it
    // immediately has crashed Electron on some Linux setups).
    keepAlive = mode === 'print';
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
      rmSync(file, { force: true });
    }, keepAlive ? 4000 : 0);
  }
}

const printSchema = z.object({ id: z.number().int().positive(), size: z.enum(['58mm', '80mm', 'a4']).optional(), mode: z.enum(['print', 'pdf']), printer: z.string().max(200).optional() });

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
        const opts = { properties: ['openFile' as const], defaultPath: rt.backupDir(), filters: [{ name: 'Sree Krishna Billing backup', extensions: ['sqlite'] }] };
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
        const target = p.mode === 'print' ? await resolveTarget(rt, state, 'receipt', p.printer) : undefined;
        const useEscPos = p.mode === 'print' && size !== 'a4' && (await receiptMethodFor(rt, state, target)) === 'escpos';
        const res = useEscPos ? await printEscPos(state, html, size as '58mm' | '80mm', target!, getSetting(rt.db, 'printing.cut')) : await printHtml(state, html, size, p.mode, `${inv.invoice_no}.pdf`, target);
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
        const p = labelsRequestSchema.extend({ mode: z.enum(['print', 'pdf']), printer: z.string().max(200).optional() }).parse(payload);
        const fontBase = pathToFileURL(join(state.rendererRoot, 'fonts')).toString();
        const labelTarget = p.mode === 'print' ? await resolveTarget(rt, state, 'label', p.printer) : undefined;
        const a4Layout = p.layout?.kind === 'a4' || (!p.layout && getSetting(rt.db, 'labels.layout').kind === 'a4');
        const rawMethod = labelTarget && !a4Layout ? await labelMethodFor(rt, state, labelTarget) : 'driver';
        const dpi = getSetting(rt.db, 'printing.label_dpi');
        // Raw modes draw the bars in whole printer dots, so the HTML is built for the printer's resolution.
        const built = buildLabelsHtml(rt, p, fontBase, rawMethod !== 'driver' ? dpi / 25.4 : undefined);
        if (built.labels === 0) return err('VALIDATION', 'None of the selected products has a printable barcode.');
        const g = built.geometry;
        const layoutNow = p.layout ?? getSetting(rt.db, 'labels.layout');
        const page: PrintPage = a4Layout ? { kind: 'a4-exact' } : { kind: 'exact', widthMicrons: Math.round(g.pageWidthMm * 1000), heightMicrons: Math.round(g.pageHeightMm * 1000) };
        const paperSetting = getSetting(rt.db, 'invoice.receipt_size');
        const res =
          labelTarget && rawMethod !== 'driver'
            ? await printRawLabels(rawMethod, built.html, g, built.pages, { dpi, paper: paperSetting === '58mm' ? '58mm' : '80mm', rowGapMm: layoutNow.rowGapMm, cut: getSetting(rt.db, 'printing.cut'), rotate: getSetting(rt.db, 'printing.label_rotate'), invert: getSetting(rt.db, 'printing.label_invert') }, labelTarget)
            : await printHtml(state, built.html, page, p.mode, 'barcode-labels.pdf', labelTarget);
        if (res.ok) {
          const d = res.data as { printed?: boolean; saved?: boolean };
          if (d.printed || d.saved) recordLabelPrint(rt.ctx(), built.labels, p.mode);
        }
        return res;
      }
      case 'print:test': {
        const u = rt.requireUser();
        if (!u.permissions.includes('settings.manage')) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
        const p = z.object({ size: z.enum(['58mm', '80mm', 'a4']), mode: z.enum(['print', 'pdf']), printer: z.string().max(200).optional() }).parse(payload);
        const target = p.mode === 'print' ? await resolveTarget(rt, state, 'receipt', p.printer) : undefined;
        const fontBase = pathToFileURL(join(state.rendererRoot, 'fonts')).toString();
        const html = renderInvoiceHtml(sampleInvoice(), shopForPrint(rt), { size: p.size, fontBase });
        if (target && p.size !== 'a4' && (await receiptMethodFor(rt, state, target)) === 'escpos') return await printEscPos(state, html, p.size, target, getSetting(rt.db, 'printing.cut'));
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
