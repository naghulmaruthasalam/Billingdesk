import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { logFile } from './paths';

function write(level: string, args: unknown[]): void {
  try {
    const file = logFile();
    mkdirSync(dirname(file), { recursive: true });
    try {
      if (statSync(file).size > 1_000_000) renameSync(file, `${file}.1`);
    } catch {
      /* file does not exist yet */
    }
    const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    appendFileSync(file, line);
  } catch {
    /* logging must never crash the app */
  }
}

export const log = {
  info: (...a: unknown[]) => write('info', a),
  warn: (...a: unknown[]) => write('warn', a),
  error: (...a: unknown[]) => write('error', a),
};
