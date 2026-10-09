import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../src/core/api';
import { CORE_CHANNELS, NATIVE_CHANNELS, ALL_CHANNELS } from '../src/shared/channels';

describe('IPC channel allow-list', () => {
  it('matches the API handlers exactly', () => {
    expect([...CORE_CHANNELS].sort()).toEqual([...CHANNELS].sort());
  });
  it('has no duplicates and no overlap with native channels', () => {
    expect(new Set(ALL_CHANNELS).size).toBe(ALL_CHANNELS.length);
    expect(NATIVE_CHANNELS.filter((c) => (CHANNELS as string[]).includes(c))).toEqual([]);
  });
});
