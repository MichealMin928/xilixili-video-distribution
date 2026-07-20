import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eligibleWeeklyJobs, isApprovedManifest, weeklyPublishingSlots } from './weekly.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xilixili-weekly-'));
  temporaryDirectories.push(directory);
  const approvedRoot = path.join(directory, 'content', 'approved');
  const manifestPath = path.join(approvedRoot, 'post-1', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ approvedForAutoPublish: true }));
  return { approvedRoot, manifestPath };
}

describe('每周自动发布边界', () => {
  it('使用四平台错峰时间', () => {
    expect(weeklyPublishingSlots).toEqual({
      wechat_channels: '12:10',
      kuaishou: '20:05',
      douyin: '20:35',
      xiaohongshu: '21:05',
    });
  });

  it('只认可批准目录内显式批准的清单', async () => {
    const { approvedRoot, manifestPath } = await fixture();
    expect(await isApprovedManifest(manifestPath, approvedRoot)).toBe(true);

    await fs.writeFile(manifestPath, JSON.stringify({ approvedForAutoPublish: false }));
    expect(await isApprovedManifest(manifestPath, approvedRoot)).toBe(false);

    const outside = path.join(path.dirname(approvedRoot), 'draft', 'manifest.json');
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, JSON.stringify({ approvedForAutoPublish: true }));
    expect(await isApprovedManifest(outside, approvedRoot)).toBe(false);
  });

  it('只选择已批准、已预填、未发布的当日任务', async () => {
    const { approvedRoot, manifestPath } = await fixture();
    const jobs = await eligibleWeeklyJobs([{
      id: 'job-1',
      manifestPath,
      prepared: ['douyin'],
      published: [],
      schedule: {
        douyin: { scheduledAt: '2026-07-21T20:35:00+08:00', window: '20:00–22:00', rationale: '晚间' },
      },
    }, {
      id: 'job-2',
      manifestPath,
      prepared: ['douyin'],
      published: ['douyin'],
      schedule: {
        douyin: { scheduledAt: '2026-07-21T20:35:00+08:00', window: '20:00–22:00', rationale: '晚间' },
      },
    }], 'douyin', approvedRoot);

    expect(jobs.map((job) => job.id)).toEqual(['job-1']);
  });
});
