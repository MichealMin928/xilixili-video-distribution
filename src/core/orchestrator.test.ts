import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import type { AppState, PlatformId, PlatformResult, PublishJob } from './types.js';

describe('平台预填增量重试', () => {
  it('统一跳过已经预填成功的平台', async () => {
    const job: PublishJob = {
      id: 'job-retry',
      createdAt: '2026-07-20T01:00:00.000Z',
      updatedAt: '2026-07-20T01:00:00.000Z',
      status: 'partial',
      kind: 'video',
      watermarkFreeConfirmed: true,
      mediaPaths: ['/workspace/video.mp4'],
      baseCopy: { title: '酒店投影选型', body: '先看真实光线和投屏稳定性。', hashtags: [] },
      variants: {} as PublishJob['variants'],
      targets: ['douyin', 'xiaohongshu', 'kuaishou'],
      results: [
        { platform: 'douyin', phase: 'prepare', status: 'success', at: '2026-07-20T01:10:00.000Z', message: 'ok' },
        { platform: 'xiaohongshu', phase: 'prepare', status: 'failed', at: '2026-07-20T01:11:00.000Z', message: 'failed' },
      ],
    };
    const state = { jobs: [job] } as AppState;
    const resultFor = (platform: PlatformId): PlatformResult => ({
      platform,
      phase: 'prepare',
      status: 'success',
      at: '2026-07-20T02:00:00.000Z',
      message: 'ok',
    });
    const prepares = Object.fromEntries([
      'douyin', 'xiaohongshu', 'kuaishou', 'wechat_channels',
    ].map((platform) => [platform, vi.fn().mockResolvedValue(resultFor(platform as PlatformId))]));
    const orchestrator = new Orchestrator();
    Object.assign(orchestrator, {
      store: {
        getJob: vi.fn().mockResolvedValue(job),
        update: vi.fn(async (update: (current: AppState) => void) => update(state)),
        addAudit: vi.fn(),
      },
      adapters: Object.fromEntries(Object.entries(prepares).map(([platform, prepare]) => [
        platform,
        { prepare, captureCurrent: vi.fn() },
      ])),
    });

    const [results, duplicateResults] = await Promise.all([
      orchestrator.prepare(job.id),
      orchestrator.prepare(job.id),
    ]);

    expect(prepares.douyin).not.toHaveBeenCalled();
    expect(prepares.xiaohongshu).toHaveBeenCalledWith(job);
    expect(prepares.kuaishou).toHaveBeenCalledWith(job);
    expect(results.map((result) => result.platform)).toEqual(['xiaohongshu', 'kuaishou']);
    expect(duplicateResults).toEqual([]);
    expect(prepares.xiaohongshu).toHaveBeenCalledTimes(1);
    expect(prepares.kuaishou).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('prepared');
  });
});
