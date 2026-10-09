import { app } from 'electron';
import { join } from 'node:path';

/**
 * All user data lives in Electron's per-user application data directory, never in the install directory:
 *   Windows: %APPDATA%\Sri Krishna Billing\
 *   Linux:   ~/.config/Sri Krishna Billing/
 * SKB_DATA_DIR overrides the location (used by automated tests and for portable/diagnostic runs).
 */
export function dataRoot(): string {
  return process.env.SKB_DATA_DIR ? process.env.SKB_DATA_DIR : app.getPath('userData');
}
export const dbFile = (): string => join(dataRoot(), 'data', 'skbilling.sqlite');
export const backupsDir = (): string => join(dataRoot(), 'backups');
export const tempDir = (): string => join(dataRoot(), 'tmp');
export const logFile = (): string => join(dataRoot(), 'logs', 'main.log');
