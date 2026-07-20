import { describe, expect, it, vi } from 'vitest';
import type { BrowserManager } from '../browser/manager.js';
import type { PublishJob } from '../core/types.js';
import { PlatformAdapter } from './adapter.js';
import { platformConfigs } from './config.js';

describe('平台页面复用', () => {
  it('登录检查复用当前平台编辑页，不重新导航', async () => {
    const page = {
      url: vi.fn(() => 'https://creator.xiaohongshu.com/publish/publish'),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn(() => ({ innerText: vi.fn().mockResolvedValue('已登录') })),
    };
    const browser = {
      getPlatformPage: vi.fn().mockResolvedValue(page),
      open: vi.fn(),
    };
    const adapter = new PlatformAdapter(
      browser as unknown as BrowserManager,
      platformConfigs.xiaohongshu,
    );

    const result = await adapter.checkLogin();

    expect(result.status).toBe('logged_in');
    expect(browser.open).not.toHaveBeenCalled();
  });

  it('空白页才打开平台首页', async () => {
    const blankPage = { url: vi.fn(() => 'about:blank') };
    const openedPage = {
      url: vi.fn(() => platformConfigs.xiaohongshu.homeUrl),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn(() => ({ innerText: vi.fn().mockResolvedValue('已登录') })),
    };
    const browser = {
      getPlatformPage: vi.fn().mockResolvedValue(blankPage),
      open: vi.fn().mockResolvedValue(openedPage),
    };
    const adapter = new PlatformAdapter(
      browser as unknown as BrowserManager,
      platformConfigs.xiaohongshu,
    );

    await adapter.checkLogin();

    expect(browser.open).toHaveBeenCalledWith('xiaohongshu', platformConfigs.xiaohongshu.homeUrl);
  });
});

describe('发布安全门槛', () => {
  it('小红书关闭定时开关后会再次核验最终状态', async () => {
    let checked = true;
    const switchInput = {
      count: vi.fn().mockResolvedValue(1),
      evaluate: vi.fn(async (callback: (element: unknown) => unknown) => callback({
        get checked() { return checked; },
        click: () => { checked = false; },
      })),
    };
    const page = {
      locator: vi.fn(() => ({ last: () => switchInput })),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new PlatformAdapter({} as BrowserManager, platformConfigs.xiaohongshu);

    await (adapter as unknown as { ensureImmediateMode(page: unknown): Promise<void> })
      .ensureImmediateMode(page);

    expect(checked).toBe(false);
    expect(switchInput.evaluate).toHaveBeenCalledTimes(3);
  });

  it('无法识别发布模式时停止发布', async () => {
    const page = {
      locator: vi.fn(() => ({ last: () => ({ count: vi.fn().mockResolvedValue(0) }) })),
    };
    const adapter = new PlatformAdapter({} as BrowserManager, platformConfigs.xiaohongshu);

    await expect((adapter as unknown as { ensureImmediateMode(page: unknown): Promise<void> })
      .ensureImmediateMode(page)).rejects.toThrow('无法确认立即发布模式');
  });

  it('快手定时作品只有收到显式转换意图才进入待发布列表', async () => {
    const pendingPage = {};
    const browser = {
      open: vi.fn().mockResolvedValue(pendingPage),
      getPlatformPage: vi.fn().mockRejectedValue(new Error('regular publish path')),
    };
    const adapter = new PlatformAdapter(browser as unknown as BrowserManager, platformConfigs.kuaishou);
    const scheduledResult = {
      platform: 'kuaishou' as const,
      phase: 'publish' as const,
      status: 'success' as const,
      scheduledAt: '2026-07-20T08:00:00.000Z',
      at: '2026-07-20T01:00:00.000Z',
      message: 'scheduled',
    };
    const job = {
      id: 'job-kuaishou',
      kind: 'video',
      variants: { kuaishou: { title: '唯一标题', body: '正文', hashtags: [] } },
      results: [scheduledResult],
    } as unknown as PublishJob;
    const pendingResult = { ...scheduledResult, scheduledAt: undefined };
    const publishPending = vi.fn().mockResolvedValue(pendingResult);
    Object.assign(adapter as object, { publishKuaishouPendingNow: publishPending });

    await expect(adapter.publish(job)).rejects.toThrow('regular publish path');
    expect(browser.open).not.toHaveBeenCalled();

    await expect(adapter.publish(job, { convertScheduledToImmediate: true })).resolves.toEqual(pendingResult);
    expect(browser.open).toHaveBeenCalledWith('kuaishou', platformConfigs.kuaishou.pendingPublishUrl);
    expect(publishPending).toHaveBeenCalledWith(job, pendingPage);
  });
});
