import { app } from 'electron';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const APP_NAME = 'Sree Krishna Billing';
/** Folder name used by builds before the product was renamed. Existing shop data is carried over, never abandoned. */
const LEGACY_APP_NAME = 'Sri Krishna Billing';

/**
 * All user data lives in Electron's per-user application data directory, never in the install directory:
 *   Windows: %APPDATA%\Sree Krishna Billing\
 *   Linux:   ~/.config/Sree Krishna Billing/
 * SKB_DATA_DIR overrides the location (used by automated tests and for portable/diagnostic runs).
 */
/**
 * Point Electron at this product's data folder. If only the pre-rename folder exists (an upgrade), it is renamed in place so
 * all bills, stock, users and backups carry over; if the rename is not possible the old folder keeps being used.
 */
export function useDataFolder(): void {
  if (process.env.SKB_DATA_DIR) return;
  const base = app.getPath('appData');
  const current = join(base, APP_NAME);
  const legacy = join(base, LEGACY_APP_NAME);
  let chosen = current;
  if (!existsSync(current) && existsSync(legacy)) {
    try {
      renameSync(legacy, current);
    } catch {
      chosen = legacy;
    }
  }
  app.setPath('userData', chosen);
}

export function dataRoot(): string {
  return process.env.SKB_DATA_DIR ? process.env.SKB_DATA_DIR : app.getPath('userData');
}
export const dbFile = (): string => join(dataRoot(), 'data', 'skbilling.sqlite');
export const backupsDir = (): string => join(dataRoot(), 'backups');
export const tempDir = (): string => join(dataRoot(), 'tmp');
export const logFile = (): string => join(dataRoot(), 'logs', 'main.log');
