import { describe, expect, it, vi } from 'vitest';
import { Store } from './store.js';
import type { AppState } from './types.js';

describe('本地状态写入', () => {
  it('串行执行并发更新，避免后写覆盖先写', async () => {
    let persisted = {
      version: 2,
      installation: { projectRoot: '/workspace', hostname: 'test', initializedAt: '2026-07-20T00:00:00.000Z' },
      accounts: {},
      jobs: [],
      audit: [],
    } as unknown as AppState;
    const store = new Store();
    vi.spyOn(store, 'read').mockImplementation(async () => structuredClone(persisted));
    vi.spyOn(store, 'write').mockImplementation(async (state) => {
      await Promise.resolve();
      persisted = structuredClone(state);
    });

    await Promise.all([
      store.update((state) => { state.audit.push({ id: 'one', at: '', action: 'one', detail: 'one', outcome: 'info' }); }),
      store.update((state) => { state.audit.push({ id: 'two', at: '', action: 'two', detail: 'two', outcome: 'info' }); }),
    ]);

    expect(persisted.audit.map((event) => event.id)).toEqual(['one', 'two']);
  });
});
