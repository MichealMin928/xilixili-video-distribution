import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Orchestrator } from './orchestrator.js';
import type { AppState, PlatformResult, PublishJob } from './types.js';

vi.mock('./daily.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./daily.js')>();
  return { ...actual, resolveDailyPlan: vi.fn() };
});

import { resolveDailyPlan } from './daily.js';
import { DailyService } from './daily-service.js';
import { getDailySchedule } from './schedule.js';

const baseJob: PublishJob = {
  id: 'job-retry',
  createdAt: '2026-07-20T01:00:00.000Z',
  updatedAt: '2026-07-20T01:00:00.000Z',
  status: 'partial',
  kind: 'video',
  mediaPaths: ['/workspace/video.mp4'],
  baseCopy: { title: '酒店投影选型', body: '正文', hashtags: [] },
  variants: {} as PublishJob['variants'],
  targets: ['douyin', 'xiaohongshu', 'kuaishou'],
  results: [
    { platform: 'douyin', phase: 'prepare', status: 'success', at: '2026-07-20T01:10:00.000Z', message: 'ok' },
    { platform: 'xiaohongshu', phase: 'prepare', status: 'failed', at: '2026-07-20T01:11:00.000Z', message: 'failed' },
    { platform: 'kuaishou', phase: 'prepare', status: 'success', at: '2026-07-20T01:12:00.000Z', message: 'ok' },
  ],
};

const state = { jobs: [baseJob] } as AppState;
const plan = {
  date: '2026-07-20',
  manifestPath: '/workspace/manifest.json',
  manifest: {
    kind: 'video' as const,
    watermarkFreeConfirmed: true,
    mediaPaths: ['/workspace/video.mp4'],
    title: '酒店投影选型',
    body: '正文',
    hashtags: [],
    targets: baseJob.targets,
  },
  existingJob: baseJob,
  schedule: getDailySchedule('2026-07-20'),
};

describe('每日任务增量重试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDailyPlan).mockResolvedValue(plan);
  });

  it('只重试此前未成功的平台，不刷新成功页面', async () => {
    const retryResult: PlatformResult = {
      platform: 'xiaohongshu',
      phase: 'prepare',
      status: 'success',
      at: '2026-07-20T02:00:00.000Z',
      message: 'ok',
    };
    const orchestrator = {
      store: { read: vi.fn().mockResolvedValue(state) },
      createJob: vi.fn(),
      checkLogin: vi.fn(),
      prepare: vi.fn().mockResolvedValue([retryResult]),
    };

    const result = await new DailyService(orchestrator as unknown as Orchestrator).start();

    expect(orchestrator.checkLogin).not.toHaveBeenCalled();
    expect(orchestrator.prepare).toHaveBeenCalledWith(baseJob.id, ['xiaohongshu']);
    expect(result.preparedBefore).toEqual(['douyin', 'kuaishou']);
    expect(result.retryTargets).toEqual([]);
  });

  it('全部成功后不再打开任何平台页面', async () => {
    const fullyPreparedJob: PublishJob = {
      ...baseJob,
      status: 'prepared',
      results: baseJob.targets.map((platform) => ({
        platform,
        phase: 'prepare' as const,
        status: 'success' as const,
        at: '2026-07-20T01:10:00.000Z',
        message: 'ok',
      })),
    };
    vi.mocked(resolveDailyPlan).mockResolvedValue({ ...plan, existingJob: fullyPreparedJob });
    const orchestrator = {
      store: { read: vi.fn().mockResolvedValue({ ...state, jobs: [fullyPreparedJob] }) },
      createJob: vi.fn(),
      checkLogin: vi.fn(),
      prepare: vi.fn(),
    };

    const result = await new DailyService(orchestrator as unknown as Orchestrator).start();

    expect(orchestrator.checkLogin).not.toHaveBeenCalled();
    expect(orchestrator.prepare).not.toHaveBeenCalled();
    expect(result.preparedNow).toEqual([]);
  });
});
