import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { chromeProfileDir } from '../core/paths.js';
import type { PlatformId } from '../core/types.js';
import { platformConfigs } from '../platforms/config.js';

export const chromeExecutable = process.env.XILIXILI_CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export class BrowserManager {
  private context?: BrowserContext;
  private pages = new Map<PlatformId, Page>();

  async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    await fs.access(chromeExecutable);
    await fs.mkdir(path.dirname(chromeProfileDir), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(chromeProfileDir), 0o700);
    await fs.mkdir(chromeProfileDir, { recursive: true, mode: 0o700 });

    this.context = await chromium.launchPersistentContext(chromeProfileDir, {
      executablePath: chromeExecutable,
      channel: undefined,
      headless: false,
      viewport: null,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
    });

    this.context.on('close', () => {
      this.context = undefined;
      this.pages.clear();
    });
    return this.context;
  }

  async getPlatformPage(platform: PlatformId): Promise<Page> {
    const existing = this.pages.get(platform);
    if (existing && !existing.isClosed()) return existing;

    const context = await this.getContext();
    const config = platformConfigs[platform];
    const reusable = context.pages().find((page) => {
      try {
        return new URL(page.url()).hostname === new URL(config.homeUrl).hostname;
      } catch {
        return false;
      }
    });
    const page = reusable ?? await context.newPage();
    this.pages.set(platform, page);
    return page;
  }

  async open(platform: PlatformId, url?: string): Promise<Page> {
    const page = await this.getPlatformPage(platform);
    await page.goto(url ?? platformConfigs[platform].homeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.bringToFront();
    return page;
  }

  async openTemporary(url: string): Promise<Page> {
    const context = await this.getContext();
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    return page;
  }

  async close(): Promise<void> {
    await this.context?.close();
  }
}
