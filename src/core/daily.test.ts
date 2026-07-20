import { describe, expect, it } from 'vitest';
import { assertPublishTime, matchingJob, preparedPlatforms, publishedPlatforms } from './daily.js';
import type { AppState, PublishJob } from './types.js';

const job: PublishJob = {
  id: 'job-1',
  createdAt: '2026-07-19T01:00:00.000Z',
  updatedAt: '2026-07-19T01:00:00.000Z',
  status: 'partial',
  kind: 'gallery',
  mediaPaths: ['/workspace/content/a.png'],
  baseCopy: { title: '酒店投影现场先看什么', body: '正文', hashtags: [] },
  variants: {} as PublishJob['variants'],
  targets: ['douyin', 'xiaohongshu'],
  schedule: {
    douyin: { scheduledAt: '2026-07-20T20:35:00+08:00', window: '20:00–22:00', rationale: '晚间' },
  },
  results: [
    { platform: 'douyin', phase: 'prepare', status: 'success', at: '2026-07-19T01:10:00.000Z', message: 'ok' },
    { platform: 'xiaohongshu', phase: 'publish', status: 'success', at: '2026-07-19T01:20:00.000Z', message: 'ok' },
  ],
};

const state: AppState = {
  version: 2,
  installation: {
    projectRoot: '/workspace',
    hostname: 'test-host',
    initializedAt: '2026-07-19T00:00:00.000Z',
  },
  accounts: {} as AppState['accounts'],
  jobs: [job],
  audit: [],
};

describe('每日手工一键运营', () => {
  it('兼容没有来源字段的旧任务并按内容去重', () => {
    const matched = matchingJob(state, '/workspace/content/manifest.json', {
      kind: 'gallery',
      watermarkFreeConfirmed: false,
      mediaPaths: ['/workspace/content/a.png'],
      title: '酒店投影现场先看什么',
      body: '新正文也不应造成同素材同标题重复发布',
      hashtags: [],
      targets: ['douyin'],
    });
    expect(matched?.id).toBe('job-1');
  });

  it('分别汇总已预填和已发布平台', () => {
    expect(preparedPlatforms(job)).toEqual(['douyin']);
    expect(publishedPlatforms(job)).toEqual(['xiaohongshu']);
  });

  it('阻止早于排期时间的发布', () => {
    expect(() => assertPublishTime(job, 'douyin', new Date('2026-07-20T12:00:00+08:00')))
      .toThrow('尚未到点');
    expect(() => assertPublishTime(job, 'douyin', new Date('2026-07-20T20:40:00+08:00')))
      .not.toThrow();
  });
});
