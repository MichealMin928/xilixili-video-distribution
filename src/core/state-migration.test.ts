import { describe, expect, it } from 'vitest';
import { migrateAppState } from './state-migration.js';
import { platformIds, type AppState } from './types.js';

describe('迁移状态自检', () => {
  it('修复旧项目绝对路径并重置过期登录状态', () => {
    const legacy = {
      version: 1,
      accounts: Object.fromEntries(platformIds.map((platform) => [platform, {
        platform,
        status: 'logged_in',
        checkedAt: '2026-07-18T00:00:00.000Z',
      }])),
      jobs: [{
        id: 'job-1',
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        status: 'prepared',
        kind: 'gallery',
        mediaPaths: ['/Users/old/Documents/洗哩洗哩投影/content/post/a.png'],
        baseCopy: { title: '标题', body: '正文', hashtags: [] },
        variants: {},
        targets: ['douyin'],
        source: {
          manifestPath: '/Users/old/Documents/洗哩洗哩投影/content/post/manifest.json',
          workflowDate: '2026-07-18',
          createdBy: 'daily_cli',
        },
        results: [{
          platform: 'douyin',
          phase: 'prepare',
          status: 'success',
          at: '2026-07-18T00:00:00.000Z',
          screenshot: '/Users/old/Documents/洗哩洗哩投影/output/playwright/a.png',
          message: 'ok',
        }],
      }],
      audit: [],
    };

    const result = migrateAppState(legacy as unknown as AppState, {
      projectRoot: '/Users/new/Documents/洗哩洗哩投影',
      hostname: 'new-mac',
      now: '2026-07-19T00:00:00.000Z',
      pathExists: (candidate) => candidate.startsWith('/Users/new/Documents/洗哩洗哩投影/'),
    });

    expect(result.relocatedPaths).toBe(3);
    expect(result.state.jobs[0].mediaPaths[0]).toBe('/Users/new/Documents/洗哩洗哩投影/content/post/a.png');
    expect(result.state.jobs[0].source?.manifestPath).toBe('/Users/new/Documents/洗哩洗哩投影/content/post/manifest.json');
    expect(result.state.accounts.douyin.status).toBe('unknown');
    expect(result.state.accounts.douyin.checkedAt).toBeUndefined();
    expect(result.state.installation.projectRoot).toBe('/Users/new/Documents/洗哩洗哩投影');
    expect(result.state.audit[0].action).toBe('system.migrated');
  });

  it('对已迁移状态保持幂等', () => {
    const state: AppState = {
      version: 2,
      installation: {
        projectRoot: '/workspace',
        hostname: 'host',
        initializedAt: '2026-07-19T00:00:00.000Z',
      },
      accounts: Object.fromEntries(platformIds.map((platform) => [platform, { platform, status: 'unknown' }])) as AppState['accounts'],
      jobs: [],
      audit: [],
    };

    const result = migrateAppState(state, { projectRoot: '/workspace', hostname: 'host' });
    expect(result.changed).toBe(false);
    expect(result.state.audit).toEqual([]);
  });
});
