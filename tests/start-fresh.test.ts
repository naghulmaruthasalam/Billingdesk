import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (dir: string, ...extra: string[]) => spawnSync(process.execPath, ['scripts/start-fresh.mjs', '--data-dir', dir, ...extra], { encoding: 'utf8' });

describe('scripts/start-fresh.mjs', () => {
  it('previews by default, then moves (never deletes) the data folder with --yes', () => {
    const root = mkdtempSync(join(tmpdir(), 'skb-fresh-'));
    const dir = join(root, 'Sree Krishna Billing');
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'skbilling.sqlite'), 'x');

    const preview = run(dir);
    expect(preview.status).toBe(0);
    expect(existsSync(dir)).toBe(true);

    const done = run(dir, '--yes');
    expect(done.status).toBe(0);
    expect(existsSync(dir)).toBe(false);
    const moved = readdirSync(root).find((n) => n.startsWith('Sree Krishna Billing.old-'));
    expect(moved).toBeTruthy();
    expect(existsSync(join(root, moved!, 'data', 'skbilling.sqlite'))).toBe(true);
  });

  it('finds the data folder of builds from before the rename', () => {
    const root = mkdtempSync(join(tmpdir(), 'skb-fresh-'));
    mkdirSync(join(root, 'Sri Krishna Billing', 'data'), { recursive: true });
    const r = spawnSync(process.execPath, ['scripts/start-fresh.mjs', '--yes'], { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: root, APPDATA: root, SKB_DATA_DIR: '' } });
    expect(r.status).toBe(0);
    expect(existsSync(join(root, 'Sri Krishna Billing'))).toBe(false);
    expect(readdirSync(root).some((n) => n.startsWith('Sri Krishna Billing.old-'))).toBe(true);
  });

  it('does nothing when there is no data folder', () => {
    const r = run(join(mkdtempSync(join(tmpdir(), 'skb-fresh-')), 'missing'), '--yes');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Nothing to do');
  });
});
