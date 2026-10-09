import type { Channel } from '@shared/channels';

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get needsApproval(): boolean {
    return this.code === 'FORBIDDEN' && !!(this.details as { needsApproval?: boolean } | undefined)?.needsApproval;
  }
}

interface Bridge {
  invoke: (channel: string, payload?: unknown) => Promise<{ ok: true; data: unknown } | { ok: false; error: ApiErrorShape }>;
  platform: string;
}

declare global {
  interface Window {
    skb?: Bridge;
  }
}

/** Call the main process. Throws ApiError with a human-readable message on failure. */
export async function call<T = unknown>(channel: Channel, payload?: unknown): Promise<T> {
  const bridge = window.skb;
  if (!bridge) throw new ApiError('INTERNAL', 'The application bridge is not available. Please restart the application.');
  const res = await bridge.invoke(channel, payload);
  if (!res.ok) throw new ApiError(res.error.code, res.error.message, res.error.details);
  return res.data as T;
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
