import { contextBridge, ipcRenderer } from 'electron';
import { ALL_CHANNELS, IPC_INVOKE } from '../shared/channels';

const allowed = new Set<string>(ALL_CHANNELS);

/**
 * The only bridge between the sandboxed renderer and the main process. It forwards a fixed allow-list of
 * channels; the main process authenticates, authorises and validates every call again.
 */
contextBridge.exposeInMainWorld('skb', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (typeof channel !== 'string' || !allowed.has(channel)) {
      return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown operation' } });
    }
    return ipcRenderer.invoke(IPC_INVOKE, channel, payload);
  },
  platform: process.platform,
});
