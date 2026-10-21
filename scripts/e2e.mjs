/* global window, document -- used inside page.evaluate callbacks, which run in the browser */
// End-to-end acceptance run against the real Electron app (built output in dist/ and dist-electron/).
//   Linux:   xvfb-run -a node scripts/e2e.mjs        (needs: npm run build first - `npm run test:e2e` does both)
//   Windows: node scripts/e2e.mjs
// Environment: E2E_OUT=<dir> for screenshots/PDF (default ./e2e-output), E2E_EXECUTABLE=<path> to test a packaged build.
import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.E2E_OUT ?? join(root, 'e2e-output'));
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'skb-e2e-'));
const PW = 'Owner@12345';
const steps = [];
const shot = async (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    steps.push([name, 'PASS', Date.now() - t]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    steps.push([name, 'FAIL', Date.now() - t, e.message]);
    console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`);
    throw e;
  }
};

async function launch() {
  const executablePath = process.env.E2E_EXECUTABLE;
  const args = executablePath ? [] : [root];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await electron.launch({ executablePath, args, env: { ...process.env, SKB_DATA_DIR: dataDir } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message));
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.waitForSelector('text=Sree Krishna Crackers Shop');
  return { app, page };
}

const hasTool = (cmd) => spawnSync(cmd, ['-v'], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const barcodeOf = (sku) => page.evaluate(async (q) => (await window.skb.invoke('products:list', { search: q })).data.rows.find((r) => r.sku === q).barcode, sku);
/** Rasterise a PDF and decode every EAN-13 in it with zbar (an independent barcode decoder), if available. */
function decodePdf(pdf, prefix) {
  if (!hasTool('pdftoppm') || !hasTool('zbarimg')) return null;
  execFileSync('pdftoppm', ['-png', '-r', '200', pdf, prefix]);
  const found = [];
  for (const f of readdirSync(out).filter((n) => n.startsWith(prefix.split(/[\\/]/).pop()) && n.endsWith('.png')).sort()) {
    const r = spawnSync('zbarimg', ['-q', '--raw', '-Sdisable', '-Sean13.enable', join(out, f)], { encoding: 'utf8' });
    found.push(...(r.stdout ?? '').split(/\r?\n/).filter((l) => /^\d{13}$/.test(l)));
  }
  return found;
}

/**
 * Poll the print queue's output folders for a file created after `since` whose name matches `nameRe`. CUPS-PDF names its
 * output after the document title (our HTML <title>: the invoice number, or "Barcode labels"). Its Ghostscript step drops
 * font-to-Unicode maps, so content is verified by rasterising rather than by text extraction.
 */
async function waitForPrinted(since, nameRe, what, timeoutMs = 30000) {
  const dirs = [join(homedir(), 'PDF'), '/var/spool/cups-pdf/ANONYMOUS'];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const d of dirs.filter((x) => existsSync(x))) {
      for (const f of readdirSync(d).filter((n) => n.toLowerCase().endsWith('.pdf') && nameRe.test(n))) {
        const full = join(d, f);
        const st = statSync(full);
        if (st.mtimeMs >= since && st.size > 3000) {
          await new Promise((r) => setTimeout(r, 400)); // let the spooler finish writing
          return { file: full };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not arrive at the printer within ${timeoutMs / 1000}s`);
}
const PRINTER = process.env.E2E_PRINTER; // name of a real system print queue, e.g. CUPS-PDF (set up by CI / the developer)
const money = (s) => Number(s.replace(/[^\d.]/g, ''));
let { app, page } = await launch();

try {
  console.log('Sree Krishna Billing - end-to-end run');
  console.log(`  data dir: ${dataDir}`);

  await step('first-run setup creates the owner and shows a recovery code', async () => {
    await page.getByRole('heading', { name: 'First-time setup' }).waitFor();
    await page.getByLabel('Username').fill('owner');
    await page.getByLabel('Your name').fill('Shop Owner');
    await page.getByLabel('Password', { exact: true }).fill(PW);
    await page.getByLabel('Confirm password').fill(PW);
    await page.getByRole('button', { name: 'Create owner account' }).click();
    const code = await page.getByTestId('recovery-code').innerText();
    assert.match(code, /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
    await page.getByLabel('I have saved this code').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Search products').waitFor();
    await shot(page, '01-pos-locked');
  });

  await step('billing is locked until the catalogue is approved', async () => {
    await page.getByLabel('Search products').fill('hydrogen');
    await page.getByRole('option', { name: /Hydrogen Bomb/ }).first().click();
    await page.getByTestId('pay').click();
    await page.getByTestId('complete-sale').click();
    await page.getByText(/catalogue has not been approved/i).waitFor();
    await shot(page, '02-billing-locked');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Clear bill' }).click();
  });

  await step('catalogue review: flagged entries, verify all, confirm address, approve', async () => {
    await page.getByRole('link', { name: 'Products' }).click();
    await page.getByRole('tab', { name: 'Catalogue review' }).click();
    await page.getByText(/Entries needing review/).waitFor();
    await shot(page, '03-catalogue-review');
    await page.getByRole('button', { name: /Mark all \d+ as verified/ }).click();
    await page.getByRole('button', { name: 'Mark all verified' }).click();
    await page.getByText('Nothing left to review.').waitFor();
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByText(/transcribed from a photograph/).waitFor();
    await shot(page, '04-settings-shop');
    await page.getByRole('button', { name: /I have checked these details/ }).click();
    await page.getByText('Confirmed').first().waitFor();
    await page.getByRole('link', { name: 'Products' }).click();
    await page.getByRole('tab', { name: 'Catalogue review' }).click();
    await page.getByTestId('approve-catalogue').click();
    await page.getByText('Billing is enabled.').waitFor();
  });

  await step('opening stock is entered (not invented) through Inventory', async () => {
    await page.getByRole('link', { name: 'Inventory' }).click();
    await page.getByRole('tab', { name: 'Opening stock' }).click();
    const qty = { 'SK-009': '20', 'SK-045': '10', 'SK-043': '10', 'SK-110': '5' };
    for (const [sku, q] of Object.entries(qty)) {
      await page.getByLabel('Filter products').fill(sku);
      const row = page.getByRole('row').filter({ hasText: sku }).first();
      await row.getByRole('textbox').fill(q);
    }
    await page.getByLabel('Filter products').fill('');
    await page.getByRole('button', { name: /Save 4 opening balances/ }).click();
    await page.getByText('4 opening balances saved').waitFor();
  });

  await step('barcode scanner: a scan adds the product wherever the cursor is, unknown codes are rejected', async () => {
    await page.getByRole('link', { name: 'New Bill' }).click();
    const code = await barcodeOf('SK-043');
    assert.match(code, /^2\d{12}$/);
    await page.getByLabel('Customer name').click();
    await page.keyboard.type(code, { delay: 4 }); // scanner speed: a key every few ms
    await page.keyboard.press('Enter');
    await page.getByTestId('cart-line').filter({ hasText: 'Hydrogen Bomb' }).waitFor();
    assert.equal(await page.getByLabel('Customer name').inputValue(), '', 'scan characters must not stay in the focused field');
    await page.getByTestId('scan-status').filter({ hasText: 'Hydrogen Bomb added' }).waitFor();
    await page.keyboard.type(code, { delay: 4 }); // scanning again increments the quantity
    await page.keyboard.press('Enter');
    await page.getByLabel('Quantity of Hydrogen Bomb').waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Quantity of Hydrogen Bomb"]').value === '2');
    await page.keyboard.type('2999999999994', { delay: 4 });
    await page.keyboard.press('Enter');
    await page.getByTestId('scan-status').filter({ hasText: 'Unknown barcode 2999999999994' }).waitFor();
    assert.equal(await page.getByTestId('cart-line').count(), 1);
    // a person typing slowly into the search box is NOT treated as a scan
    await page.getByLabel('Search products').click();
    await page.keyboard.type('classic', { delay: 160 });
    assert.equal(await page.getByLabel('Search products').inputValue(), 'classic');
    await page.getByLabel('Search products').fill('');
    await shot(page, '04a-scan');
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Clear bill' }).click();
  });

  let invoiceNo;
  await step('POS: multi-product bill, discounts only on eligible items, cash sale with change', async () => {
    await page.getByRole('link', { name: 'New Bill' }).click();
    const search = page.getByLabel('Search products');
    await search.fill('15 cm green');
    await page.getByRole('option', { name: /15 cm Green/ }).first().waitFor();
    await search.press('Enter'); // keyboard add
    await search.fill('2*classic');
    await page.getByRole('option', { name: /Classic Bomb/ }).first().waitFor();
    await search.press('Enter');
    await search.fill('20 items');
    await page.getByRole('option', { name: /20 Items/ }).first().click(); // gift box: no discount
    const lines = page.getByTestId('cart-line');
    assert.equal(await lines.count(), 3);
    // 65 + 2*150 + 450 = 815.00 ; discount 6.50 + 30.00 = 36.50 ; payable 778.50
    assert.equal(money(await page.getByTestId('cart-total').innerText()), 778.5);
    // the discount is given once, on the total bill: cart rows show list amounts only (65.00, 300.00, 450.00)
    await page.getByText('Discount (10%)').waitFor();
    await page.getByTestId('change-discount').waitFor();
    assert.equal((await page.getByTestId('cart-qty').innerText()).replace(/\D+/g, ''), '4', 'total quantity shown beside the total (1 + 2 + 1)');
    const rowsText = await lines.allInnerTexts();
    assert.ok(rowsText.every((t) => !/%/.test(t)), 'no per-item discount shown in the cart rows');
    assert.ok(/65\.00/.test(rowsText[0]) && /300\.00/.test(rowsText[1]) && /450\.00/.test(rowsText[2]), 'cart rows show list amounts');
    await shot(page, '05-pos-cart');
    await page.keyboard.press('F8');
    await page.getByTestId('payable').waitFor();
    assert.equal(money(await page.getByTestId('payable').innerText()), 778.5);
    await page.getByLabel('Cash received', { exact: true }).fill('1000');
    assert.equal(money(await page.getByTestId('change-due').innerText()), 221.5);
    await shot(page, '06-payment-dialog');
    await page.keyboard.press('F8'); // complete
    invoiceNo = (await page.getByTestId('invoice-no').innerText()).trim();
    assert.equal(invoiceNo, 'SKP-000001');
    await page.getByText('Return change').waitFor();
    await shot(page, '07-sale-done');
  });

  await step('print: Save as PDF through the print workflow, English-only bill verified in the PDF', async () => {
    const pdf = join(out, 'invoice-reprint.pdf');
    rmSync(pdf, { force: true });
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, pdf);
    await page.getByRole('button', { name: 'Save PDF' }).click();
    for (let i = 0; i < 40 && !existsSync(pdf); i++) await page.waitForTimeout(250);
    assert.ok(existsSync(pdf), 'PDF was not written');
    const head = readFileSync(pdf).subarray(0, 5).toString();
    assert.equal(head, '%PDF-', 'output is not a PDF');
    assert.ok(statSync(pdf).size > 10_000, 'PDF is suspiciously small');
    if (hasTool('pdftotext')) {
      const txt = join(out, 'invoice-reprint.txt');
      execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', pdf, txt]);
      const text = readFileSync(txt, 'utf8').normalize('NFC');
      console.log(`    pdftotext excerpt: ${JSON.stringify(text.slice(0, 160))}`);
      assert.match(text, /SKP-000001/);
      assert.match(text, /Sree Krishna Crackers Shop/);
      assert.doesNotMatch(text, /[\u0B80-\u0BFF]/, 'bills are English only - no Tamil expected');
      assert.match(text, /Discount \(10%\)/);
      assert.match(text, /Total qty: 4/);
      assert.match(text, /Item\s+Price\s+Qty\s+Total/, 'column order: item, price, qty, total');
      assert.match(text, /Goods once sold cannot be taken back/);
      assert.match(text, /Wishing you a Happy Diwali/);
      assert.match(text, /Paid - Cash\s+₹778\.50/);
      assert.doesNotMatch(text, /tendered/);
      assert.doesNotMatch(text, /Kovaipudur/);
      assert.match(text, /4\/210, J\.V\. Complex, Kurunthachalam Nagar,\s+N\.G\.G\.O\. Colony Main Road, Coimbatore -\s+641017\./, 'address with NGGO Colony on the bill');
      assert.match(text, /778\.50/);
      assert.match(text, /Classic Bomb/);
      assert.doesNotMatch(text, /DUPLICATE COPY/, 'first print must not be marked as a duplicate');
      if (hasTool('pdffonts')) assert.match(execFileSync('pdffonts', [pdf], { encoding: 'utf8' }), /Inter|Noto/i);
      if (hasTool('pdftoppm')) execFileSync('pdftoppm', ['-png', '-r', '110', '-singlefile', pdf, join(out, 'invoice-reprint')]);
    } else console.log('    (poppler-utils not installed: PDF text/font checks skipped)');
    await page.getByRole('button', { name: 'Preview / reprint' }).click();
    await page.getByTitle('Invoice preview').waitFor();
    await page.waitForTimeout(500);
    await shot(page, '08-print-preview');
    await page.keyboard.press('Escape');
  });

  await step('POS: UPI sale, then a second bill shows stock deducted exactly once', async () => {
    await page.getByTestId('new-bill').click();
    const search = page.getByLabel('Search products');
    await search.fill('hydrogen');
    await page.getByRole('option', { name: /Hydrogen Bomb/ }).first().click();
    await page.getByTestId('pay').click();
    await page.getByRole('radio', { name: 'UPI' }).click();
    assert.equal(money(await page.getByTestId('payable').innerText()), 81);
    await page.getByRole('textbox').first().fill('UTR12345');
    await page.getByTestId('complete-sale').click();
    assert.equal((await page.getByTestId('invoice-no').innerText()).trim(), 'SKP-000002');
    await page.getByTestId('new-bill').click();
  });

  await step('sales history, details, partial return and cancellation', async () => {
    await page.getByRole('link', { name: 'Sales History' }).click();
    await page.getByTestId('sales-row').first().waitFor();
    assert.equal(await page.getByTestId('sales-row').count(), 2);
    await page.getByTestId('sales-row').filter({ hasText: 'SKP-000001' }).click();
    await page.getByRole('heading', { name: 'Invoice SKP-000001' }).waitFor();
    await shot(page, '09-invoice-detail');
    await page.getByRole('button', { name: 'Return items' }).click();
    await page.getByLabel(/Return quantity for Classic Bomb/).fill('1');
    await page.getByLabel('Reason (required)').fill('Customer changed mind');
    await page.getByRole('button', { name: 'Record return' }).click();
    await page.getByText(/Return RET-00001 recorded - refund ₹135\.00/).waitFor();
    await page.getByRole('heading', { name: 'Invoice SKP-000001' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('sales-row').filter({ hasText: 'SKP-000002' }).click();
    await page.getByRole('button', { name: 'Cancel bill' }).click();
    await page.getByLabel('Reason (required)').fill('Test cancellation');
    await page.getByRole('button', { name: 'Cancel this bill' }).click();
    await page.getByText('Bill cancelled').waitFor();
    await page.getByText(/Cancelled .* Test cancellation/).waitFor();
    await shot(page, '10-cancelled');
    await page.keyboard.press('Escape');
  });

  await step('inventory reflects sale, return and cancellation exactly once', async () => {
    await page.getByRole('link', { name: 'Inventory' }).click();
    const stockOf = async (sku) => {
      await page.getByLabel('Search stock').fill(sku);
      const row = page.getByRole('row').filter({ hasText: sku }).first();
      await row.waitFor();
      return Number((await row.locator('td').nth(3).innerText()).trim());
    };
    assert.equal(await stockOf('SK-045'), 9); // Classic Bomb: 10 opening - 2 sold + 1 returned
    assert.equal(await stockOf('SK-043'), 10); // Hydrogen Bomb: 10 - 1 sold + 1 restored by the cancellation
    assert.equal(await stockOf('SK-009'), 19); // 15 cm Green: 20 - 1
    assert.equal(await stockOf('SK-110'), 4); // Gift box: 5 - 1
    await page.getByRole('tab', { name: 'Movement history' }).click();
    await page.getByText(/Return RET-00001 of SKP-000001/).waitFor();
    await page.getByText(/Cancelled SKP-000002: Test cancellation/).waitFor();
    await shot(page, '11a-stock-movements');
  });

  await step('barcode labels: print to PDF and decode the bars with an independent scanner', async () => {
    await page.getByRole('link', { name: 'Products' }).click();
    await page.getByRole('tab', { name: 'Barcode labels' }).click();
    assert.equal(await page.getByLabel('Label type').inputValue(), 't34x20x3', "the shop's own roll (34 x 20 mm, 3 across) is the default label size");
    await page.getByLabel('Label type').selectOption({ label: 'Roll label 50 × 30 mm' });
    const codes = [await barcodeOf('SK-043'), await barcodeOf('SK-045')];
    for (const [query, product] of [['hydrogen', 'Hydrogen Bomb'], ['classic bomb', 'Classic Bomb']]) {
      await page.getByLabel('Search products for labels').fill(query);
      await page.getByRole('checkbox', { name: `Select ${product}` }).check(); // waits for the filtered row
    }
    await page.getByText(/2 labels on 2 roll labels/).waitFor();
    await shot(page, '07a-labels-thermal');
    const pdf = join(out, 'labels-thermal.pdf');
    rmSync(pdf, { force: true });
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, pdf);
    await page.getByRole('button', { name: 'Save as PDF' }).click();
    for (let i = 0; i < 40 && !existsSync(pdf); i++) await page.waitForTimeout(250);
    assert.ok(existsSync(pdf), 'label PDF was not written');
    if (hasTool('pdfinfo')) {
      const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
      assert.match(info, /Pages:\s+2/);
      const [w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info).slice(1).map(Number);
      assert.ok(Math.abs(w - 141.73) < 1.5 && Math.abs(h - 85.04) < 1.5, `expected 50 x 30 mm pages (141.7 x 85.0 pt), got ${w} x ${h}`);
    }
    const thermal = decodePdf(pdf, join(out, 'labels-thermal'));
    if (thermal) assert.deepEqual(thermal.sort(), [...codes].sort(), 'decoded barcodes differ from the products');
    else console.log('    (zbar not installed: barcode decode skipped)');

    // A4 sticker sheet starting at label 3 (re-using a part-used sheet)
    await page.getByLabel('Label type').selectOption({ label: 'A4 sticker sheet 3 × 8 (24 labels)' });
    await page.getByLabel('Start at label no.').fill('3');
    await page.getByText(/2 labels on 1 sheet/).waitFor();
    await shot(page, '07b-labels-a4');
    const pdf2 = join(out, 'labels-a4.pdf');
    rmSync(pdf2, { force: true });
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, pdf2);
    await page.getByRole('button', { name: 'Save as PDF' }).click();
    for (let i = 0; i < 40 && !existsSync(pdf2); i++) await page.waitForTimeout(250);
    assert.ok(existsSync(pdf2), 'A4 label PDF was not written');
    if (hasTool('pdfinfo')) assert.match(execFileSync('pdfinfo', [pdf2], { encoding: 'utf8' }), /Pages:\s+1/);
    const a4 = decodePdf(pdf2, join(out, 'labels-a4'));
    if (a4) assert.deepEqual(a4.sort(), [...codes].sort());
  });

  await step('printers: choose a real system printer, print silently (receipt test + label test)', async () => {
    if (!PRINTER) return console.log('    (set E2E_PRINTER to a system print queue name, e.g. CUPS-PDF, to run this step)');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Printers' }).click();
    await page.getByText(PRINTER, { exact: false }).first().waitFor();
    await shot(page, '07c-printers');
    // Regression for "Print starts, nothing prints, the app closes": printing must go through the in-app printer chooser
    // (no operating-system print dialog) and the app must stay open.
    await page.getByRole('link', { name: 'Sales History' }).click();
    await page.getByTestId('sales-row').filter({ hasText: 'SKP-000001' }).click();
    await page.getByRole('button', { name: 'Print / reprint' }).click();
    await page.getByTitle('Invoice preview').waitFor();
    const tp = Date.now() - 1000;
    await page.getByRole('button', { name: /^Print/ }).last().click();
    await page.getByRole('heading', { name: 'Choose printer' }).waitFor();
    await shot(page, '07d-choose-printer');
    await page.getByLabel('Printer to use').selectOption({ value: PRINTER });
    await page.getByTestId('printer-confirm').click();
    await waitForPrinted(tp, /^SKP-000001/, 'receipt printed through the printer chooser');
    assert.equal(app.windows().length >= 1, true, 'the application must still be running after printing');
    await page.getByText(/Sent to CUPS-PDF/).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Printers' }).click();
    await page.getByLabel('Receipt printer').selectOption({ value: PRINTER });
    await page.getByLabel('Label printer', { exact: true }).selectOption({ value: PRINTER });
    // These switches save through the backend, so their state flips after the round trip (not instantly).
    for (const name of ['Don\'t ask - always use the printer chosen here', 'Print the receipt automatically after each sale']) {
      const box = page.getByRole('checkbox', { name });
      await page.waitForFunction((n) => [...document.querySelectorAll('[role=checkbox]')].some((b) => b.closest('label')?.textContent?.includes(n) && !b.disabled), name);
      await box.click();
      await page.waitForFunction((n) => [...document.querySelectorAll('[role=checkbox]')].some((b) => b.closest('label')?.textContent?.includes(n) && b.getAttribute('aria-checked') === 'true'), name);
    }
    const t0 = Date.now() - 1000;
    await page.getByRole('button', { name: 'Print test receipt' }).click();
    const rc = await waitForPrinted(t0, /^TEST-000000/, 'test receipt');
    if (hasTool('pdftoppm')) execFileSync('pdftoppm', ['-png', '-r', '90', '-singlefile', rc.file, join(out, 'printed-test-receipt')]);
    const t1 = Date.now() - 1000;
    await page.getByRole('button', { name: 'Print test label' }).click();
    const lab = await waitForPrinted(t1, /^Barcode[_ ]labels/, 'test label');
    if (hasTool('pdftoppm') && hasTool('zbarimg')) {
      const decoded = decodePdf(lab.file, join(out, 'printed-label'));
      assert.equal(decoded.length, 1, 'the printed label must contain one decodable barcode');
    }
  });

  await step('thermal receipt printer: ESC/POS raster job reaches a raw queue (RP-3200 style), app stays open', async () => {
    const dir = process.env.E2E_ESCPOS_DIR;
    const rawPrinter = process.env.E2E_ESCPOS_PRINTER;
    if (!dir || !rawPrinter) return console.log('    (set E2E_ESCPOS_DIR and E2E_ESCPOS_PRINTER - see scripts/fake-thermal-printer.mjs - to run this step)');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Printers' }).click();
    await page.getByLabel('Receipt printer').selectOption({ value: rawPrinter });
    await page.waitForFunction(() => document.querySelector('[aria-label="Receipt printer"]').value !== '');
    await page.getByLabel('How receipts are sent').selectOption({ value: 'escpos' });
    await page.waitForTimeout(500);
    await shot(page, '07e-escpos-settings');
    const before = existsSync(dir) ? readdirSync(dir).length : 0;
    await page.getByRole('button', { name: 'Print test receipt' }).click();
    let file;
    for (let i = 0; i < 60 && !file; i++) {
      await page.waitForTimeout(500);
      const now = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.bin')).sort() : [];
      if (now.length > before) file = join(dir, now[now.length - 1]);
    }
    assert.ok(file, 'no ESC/POS job arrived at the raw printer queue');
    const buf = readFileSync(file);
    assert.deepEqual([...buf.subarray(0, 2)], [0x1b, 0x40], 'job must start with ESC @');
    assert.deepEqual([...buf.subarray(2, 6)], [0x1d, 0x76, 0x30, 0x00], 'then a GS v 0 raster block');
    assert.equal(buf[6] | (buf[7] << 8), 72, '576 dots = 72 bytes per row (80 mm paper)');
    assert.deepEqual([...buf.subarray(buf.length - 3)], [0x1d, 0x56, 0x01], 'job must end with a cut');
    assert.ok(buf.length > 20000, 'raster data looks too small');
    // Decode the raster to a PBM image so the receipt can be inspected visually (and by OCR-free checks).
    let i = 2, rows = 0; const parts = [];
    while (i < buf.length && buf[i] === 0x1d && buf[i + 1] === 0x76) { const bpr = buf[i + 4] | (buf[i + 5] << 8), h = buf[i + 6] | (buf[i + 7] << 8); parts.push(buf.subarray(i + 8, i + 8 + bpr * h)); rows += h; i += 8 + bpr * h; }
    writeFileSync(join(out, 'escpos-receipt.pbm'), Buffer.concat([Buffer.from(`P4\n576 ${rows}\n`), ...parts]));
    assert.ok(rows > 300, 'receipt image is too short');
    assert.ok(app.windows().length >= 1, 'the application must still be running');
    await page.getByText(/Test receipt sent to/).waitFor();
    // Automatic mode must detect this raw/thermal queue by itself and send ESC/POS too (the RP-3200-LITE case)
    await page.getByLabel('How receipts are sent').selectOption({ value: 'auto' });
    await page.waitForTimeout(500);
    const beforeAuto = readdirSync(dir).filter((f) => f.endsWith('.bin')).length;
    await page.getByRole('button', { name: 'Print test receipt' }).click();
    let autoJob = false;
    for (let i = 0; i < 60 && !autoJob; i++) {
      await page.waitForTimeout(500);
      autoJob = readdirSync(dir).filter((f) => f.endsWith('.bin')).length > beforeAuto;
    }
    assert.ok(autoJob, 'automatic mode did not send ESC/POS to the thermal/raw queue');
    // Barcode labels to the same thermal queue: drawn at 203 dpi, centred, sent as ESC/POS (no driver), and the bars must scan
    await page.evaluate(() => window.skb.invoke('settings:update', { patch: { 'labels.layout': { kind: 'thermal', widthMm: 50, heightMm: 30, cols: 3, rows: 8, marginTopMm: 10, marginLeftMm: 7, gapMm: 0, rollCols: 1, colGapMm: 2, rowGapMm: 2, rollLeftMm: 0, showPrice: true, showTamil: false, showShop: true } } }));
    await page.getByLabel('Label printer', { exact: true }).selectOption({ value: rawPrinter });
    await page.waitForTimeout(500);
    const beforeLabel = readdirSync(dir).filter((f) => f.endsWith('.bin')).length;
    await page.getByRole('button', { name: 'Print test label' }).click();
    let labelFile;
    for (let i = 0; i < 80 && !labelFile; i++) {
      await page.waitForTimeout(500);
      const now = readdirSync(dir).filter((f) => f.endsWith('.bin')).sort();
      if (now.length > beforeLabel) labelFile = join(dir, now[now.length - 1]);
    }
    assert.ok(labelFile, 'no ESC/POS label job arrived at the thermal queue');
    const lbuf = readFileSync(labelFile);
    assert.deepEqual([...lbuf.subarray(0, 2)], [0x1b, 0x40], 'label job must start with ESC @');
    let li = 2, lrows = 0; const lparts = [];
    while (li < lbuf.length && lbuf[li] === 0x1d && lbuf[li + 1] === 0x76) { const bpr = lbuf[li + 4] | (lbuf[li + 5] << 8), h = lbuf[li + 6] | (lbuf[li + 7] << 8); lparts.push(lbuf.subarray(li + 8, li + 8 + bpr * h)); lrows += h; li += 8 + bpr * h; }
    assert.equal(lrows, 240, 'one 50 x 30 mm label = 240 rows at 8 dots/mm');
    const lpbm = join(out, 'escpos-label.pbm');
    writeFileSync(lpbm, Buffer.concat([Buffer.from(`P4\n576 ${lrows}\n`), ...lparts]));
    if (hasTool('zbarimg')) {
      const z = spawnSync('zbarimg', ['-q', '--raw', '-Sdisable', '-Sean13.enable', lpbm], { encoding: 'utf8' });
      assert.match(z.stdout.trim(), /^\d{13}$/, `the barcode on the thermal label must scan (zbar said: ${JSON.stringify(z.stdout)} ${z.stderr})`);
    }
    // Several labels in one job (copies + different products): every label must be its own, correctly positioned image
    const multi = await page.evaluate(async () => {
      const list = await window.skb.invoke('products:list', { search: 'SK-0' });
      const rows = list.data.rows.filter((r) => r.barcode).slice(0, 2);
      const r = await window.skb.invoke('print:labels', { items: [{ productId: rows[0].id, copies: 1 }, { productId: rows[1].id, copies: 2 }], mode: 'print' });
      return { ok: r.ok, err: r.error?.message, codes: [rows[0].barcode, rows[1].barcode, rows[1].barcode] };
    });
    assert.ok(multi.ok, `multi-label print failed: ${multi.err}`);
    let multiFile;
    for (let i = 0; i < 80 && !multiFile; i++) {
      await page.waitForTimeout(500);
      const now = readdirSync(dir).filter((f) => f.endsWith('.bin')).sort();
      if (now.length > beforeLabel + 1) multiFile = join(dir, now[now.length - 1]);
    }
    assert.ok(multiFile, 'multi-label job did not arrive');
    const mbuf = readFileSync(multiFile);
    let mi = 2, mrows = 0; const mparts = [];
    while (mi < mbuf.length) {
      if (mbuf[mi] === 0x1d && mbuf[mi + 1] === 0x76) { const bpr = mbuf[mi + 4] | (mbuf[mi + 5] << 8), h = mbuf[mi + 6] | (mbuf[mi + 7] << 8); mparts.push(mbuf.subarray(mi + 8, mi + 8 + bpr * h)); mrows += h; mi += 8 + bpr * h; }
      else if (mbuf[mi] === 0x1b && mbuf[mi + 1] === 0x64) mi += 3;
      else if (mbuf[mi] === 0x1d && mbuf[mi + 1] === 0x56) mi += 3;
      else if (mbuf[mi] === 0x1b && mbuf[mi + 1] === 0x40) mi += 2;
      else break;
    }
    assert.equal(mrows, 3 * 240, 'three 30 mm labels = 720 rows');
    const mpbm = join(out, 'escpos-labels-3.pbm');
    writeFileSync(mpbm, Buffer.concat([Buffer.from(`P4\n576 ${mrows}\n`), ...mparts]));
    if (hasTool('zbarimg')) {
      const z = spawnSync('zbarimg', ['-q', '--raw', '-Sdisable', '-Sean13.enable', mpbm], { encoding: 'utf8' });
      // (zbar reports a repeated identical symbol once, so compare the distinct codes; the row count above proves three labels)
      assert.deepEqual([...new Set(z.stdout.trim().split('\n').filter((l) => /^\d{13}$/.test(l)))].sort(), [...new Set(multi.codes)].sort(), `the labels must scan as ${multi.codes} (zbar: ${JSON.stringify(z.stdout)})`);
    }
    // Dedicated label printer (TVS LP 46 Lite, 34 x 20 mm labels, 3 across): TSPL bitmap job through the raw queue
    const tspl = await page.evaluate(async () => {
      await window.skb.invoke('settings:update', { patch: { 'printing.label_method': 'tspl', 'labels.layout': { kind: 'thermal', widthMm: 34, heightMm: 20, cols: 3, rows: 8, marginTopMm: 10, marginLeftMm: 7, gapMm: 0, rollCols: 3, colGapMm: 2.5, rowGapMm: 2, rollLeftMm: 0, showPrice: true, showTamil: false, showShop: false } } });
      const list = await window.skb.invoke('products:list', { search: 'SK-0' });
      const rows = list.data.rows.filter((r) => r.barcode).slice(0, 2);
      const r = await window.skb.invoke('print:labels', { items: [{ productId: rows[0].id, copies: 1 }, { productId: rows[1].id, copies: 2 }], mode: 'print' });
      return { ok: r.ok, err: r.error?.message, codes: [rows[0].barcode, rows[1].barcode, rows[1].barcode] };
    });
    assert.ok(tspl.ok, `TSPL label print failed: ${tspl.err}`);
    let tsplFile;
    for (let i = 0; i < 80 && !tsplFile; i++) {
      await page.waitForTimeout(500);
      const now = readdirSync(dir).filter((f) => f.endsWith('.bin')).sort();
      if (now.length > beforeLabel + 2) tsplFile = join(dir, now[now.length - 1]);
    }
    assert.ok(tsplFile, 'TSPL job did not arrive');
    const tbuf = readFileSync(tsplFile);
    const ttext = tbuf.toString('latin1');
    assert.match(ttext, /^SIZE 107 mm,20 mm\r\nGAP 2 mm,0 mm\r\n/, 'TSPL header: one row = 3 x 34 mm + 2 gaps, 2 mm between rows');
    const bm = /BITMAP 0,0,(\d+),(\d+),0,/.exec(ttext);
    assert.ok(bm, 'TSPL BITMAP command');
    const bpr = Number(bm[1]), bh = Number(bm[2]);
    assert.equal(bh, 160, '20 mm at 203 dpi = 160 dots');
    assert.equal(ttext.match(/PRINT 1,1/g).length, 1, 'three labels fit one row = one PRINT');
    const dataStart = bm.index + bm[0].length;
    const px = (x, y) => (tbuf[dataStart + y * bpr + (x >> 3)] & (0x80 >> (x & 7))) === 0; // TSPL: 0 bit = black
    writeFileSync(join(out, 'tspl-row.pbm'), Buffer.concat([Buffer.from(`P1\n${bpr * 8} ${bh}\n`), Buffer.from(Array.from({ length: bh }, (_, y) => Array.from({ length: bpr * 8 }, (_, x) => (px(x, y) ? '1' : '0')).join('')).join('\n'))]));
    if (hasTool('zbarimg')) {
      const pitch = (34 + 2.5) * 203 / 25.4; // dots from one label to the next
      for (const [idx, want] of [[0, tspl.codes[0]], [1, tspl.codes[1]], [2, tspl.codes[2]]]) {
        const x0 = Math.round(idx * pitch), x1 = Math.min(bpr * 8, Math.round(x0 + 34 * 203 / 25.4));
        const crop = join(out, `tspl-label-${idx}.pbm`);
        writeFileSync(crop, `P1\n${x1 - x0} ${bh}\n` + Array.from({ length: bh }, (_, y) => Array.from({ length: x1 - x0 }, (_, x) => (px(x0 + x, y) ? '1' : '0')).join('')).join('\n'));
        const z = spawnSync('zbarimg', ['-q', '--raw', '-Sdisable', '-Sean13.enable', crop], { encoding: 'utf8' });
        assert.equal(z.stdout.trim(), want, `label ${idx + 1} of the row must scan as ${want} (zbar: ${JSON.stringify(z.stdout)})`);
      }
    }
    await page.evaluate(() => window.skb.invoke('settings:update', { patch: { 'printing.label_method': 'auto', 'labels.layout': { kind: 'thermal', widthMm: 34, heightMm: 20, cols: 3, rows: 8, marginTopMm: 10, marginLeftMm: 7, gapMm: 0, rollCols: 3, colGapMm: 2.5, rowGapMm: 2, rollLeftMm: 0, showPrice: true, showTamil: false, showShop: true } } }));
    await page.getByLabel('Label printer', { exact: true }).selectOption({ value: '' });
    // switch back so later steps use the normal driver queue (automatic: a normal printer goes through its driver)
    await page.getByLabel('How receipts are sent').selectOption({ value: 'auto' });
    await page.getByLabel('Receipt printer').selectOption({ value: PRINTER ?? '' });
    await page.waitForTimeout(500);
  });

  await step('dashboard totals and reports', async () => {
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByText('Completed bills').waitFor();
    await shot(page, '11-dashboard');
    await page.getByRole('link', { name: 'Reports' }).click();
    await page.getByRole('heading', { name: 'Sales summary' }).waitFor();
    await page.waitForSelector('table');
    await shot(page, '12-reports');
  });

  await step('backup now, then restore from the backup list', async () => {
    await page.getByRole('link', { name: 'Backup & Restore' }).click();
    await page.getByTestId('backup-now').click();
    await page.getByText(/Backup saved:/).waitFor();
    const backups = join(dataDir, 'backups');
    const files = readdirSync(backups).filter((f) => f.endsWith('.sqlite'));
    assert.ok(files.length >= 1, 'no backup file created');
    assert.ok(statSync(join(backups, files[0])).size > 50_000);
    await page.getByRole('button', { name: 'Restore…' }).first().click();
    await page.getByText('This file is a valid, intact backup.').waitFor();
    await shot(page, '13-restore-preview');
    await page.getByLabel('I understand that current data will be overwritten').check();
    await page.getByLabel('Your password').fill(PW);
    await page.getByTestId('confirm-restore').click();
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    await page.getByLabel('Username').fill('owner');
    await page.getByLabel('Password', { exact: true }).fill(PW);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'New Bill' }).click();
    await page.getByLabel('Search products').waitFor();
    // the restored data is the state at backup time: both bills, the return and the cancellation are present
    await page.getByRole('link', { name: 'Sales History' }).click();
    await page.getByTestId('sales-row').first().waitFor();
    assert.equal(await page.getByTestId('sales-row').count(), 2);
  });

  await step('the application makes no network requests', async () => {
    const r = await page.evaluate(() => fetch('https://example.com/').then(() => 'reached').catch(() => 'blocked'));
    assert.equal(r, 'blocked');
  });

  await step('restart: data persists and the owner can sign in again', async () => {
    await app.close();
    ({ app, page } = await launch());
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    await page.getByLabel('Username').fill('owner');
    await page.getByLabel('Password', { exact: true }).fill(PW);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'Sales History' }).click();
    await page.getByTestId('sales-row').first().waitFor();
    assert.equal(await page.getByTestId('sales-row').count(), 2);
    await page.getByRole('link', { name: 'Products' }).click();
    await page.getByText('114 shown').waitFor();
    await shot(page, '14-products-after-restart');
  });

  await step('auto-print: a completed sale goes straight to the chosen printer, no print window', async () => {
    if (!PRINTER) return;
    await page.getByRole('link', { name: 'New Bill' }).click();
    const code = await barcodeOf('SK-043');
    await page.getByLabel('Search products').click();
    await page.keyboard.type(code, { delay: 4 });
    await page.keyboard.press('Enter');
    await page.getByTestId('cart-line').filter({ hasText: 'Hydrogen Bomb' }).waitFor();
    const t0 = Date.now() - 1000;
    await page.getByTestId('pay').click();
    await page.getByTestId('complete-sale').click();
    const no = (await page.getByTestId('invoice-no').innerText()).trim();
    assert.equal(no, 'SKP-000003');
    const got = await waitForPrinted(t0, new RegExp(`^${no}`), 'auto-printed receipt');
    if (hasTool('pdftoppm')) execFileSync('pdftoppm', ['-png', '-r', '90', '-singlefile', got.file, join(out, 'printed-auto-receipt')]);
    await page.getByTestId('new-bill').click();
  });

  console.log('\nAll end-to-end steps passed.');
} catch (e) {
  console.log('\nE2E FAILED:', e.message);
  try { await shot(page, 'failure'); } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  await app.close().catch(() => undefined);
  console.log(`Screenshots and PDF: ${out}`);
}
