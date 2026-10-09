import { call } from './api';
import type { FileResult } from './types';

export async function saveFileResult(f: FileResult): Promise<{ saved: boolean; path?: string }> {
  const ext = f.filename.split('.').pop() ?? '';
  return call('dialog:saveFile', { defaultName: f.filename, text: f.text, base64: f.base64, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
}

export async function openTextFile(extensions: string[], name = 'Files'): Promise<{ path: string; name: string; text: string } | null> {
  return call('dialog:openText', { filters: [{ name, extensions }] });
}
