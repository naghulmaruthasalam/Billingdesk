// End-to-end acceptance run against the real Electron app (built output in dist/ and dist-electron/).
//   Linux:   xvfb-run -a node scripts/e2e.mjs        (needs: npm run build first - `npm run test:e2e` does both)
//   Windows: node scripts/e2e.mjs
// Environment: E2E_OUT=<dir> for screenshots/PDF (default ./e2e-output), E2E_EXECUTABLE=<path> to test a packaged build.
import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  await page.waitForSelector('text=Sri Krishna Pattasu Kadai');
  return { app, page };
}

const money = (s) => Number(s.replace(/[^\d.]/g, ''));
let { app, page } = await launch();

try {
  console.log('Sri Krishna Billing - end-to-end run');
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
    await page.getByText('No discount', { exact: false }).first().waitFor();
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

  await step('print: Save as PDF through the print workflow, Tamil text verified in the PDF', async () => {
    const pdf = join(out, 'invoice-reprint.pdf');
    rmSync(pdf, { force: true });
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, pdf);
    await page.getByRole('button', { name: 'Save PDF' }).click();
    for (let i = 0; i < 40 && !existsSync(pdf); i++) await page.waitForTimeout(250);
    assert.ok(existsSync(pdf), 'PDF was not written');
    const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
    assert.match(text, /SKP-000001/);
    assert.match(text, /Sri Krishna Pattasu Kadai/);
    assert.match(text, /ஸ்ரீ கிருஷ்ணா பட்டாசு கடை/, 'Tamil shop name missing from PDF text');
    assert.match(text, /778\.50/);
    assert.match(text, /Hydrogen|Classic Bomb/);
    assert.match(text, /கிளாசிக் பாம்/);
    const fonts = execFileSync('pdffonts', [pdf], { encoding: 'utf8' });
    assert.match(fonts, /Noto/i);
    execFileSync('pdftoppm', ['-png', '-r', '110', '-singlefile', pdf, join(out, 'invoice-reprint')]);
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

  console.log('\nAll end-to-end steps passed.');
} catch (e) {
  console.log('\nE2E FAILED:', e.message);
  try { await shot(page, 'failure'); } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  await app.close().catch(() => undefined);
  console.log(`Screenshots and PDF: ${out}`);
}
