import { describe, expect, it, vi } from 'vitest';
import type { BrowserManager } from '../browser/manager.js';
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
