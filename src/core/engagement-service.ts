import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright-core';
import { BrowserManager } from '../browser/manager.js';
import { platformConfigs } from '../platforms/config.js';
import { createEngagementItem, normalizeEngagementText, parsePlatformDate } from './engagement.js';
import { EngagementStore } from './engagement-store.js';
import { engagementScreenshotDir } from './paths.js';
import type { Store } from './store.js';
import {
  platformIds,
  type EngagementItem,
  type EngagementKind,
  type EngagementSurfaceResult,
  type EngagementSurfaceStatus,
  type PlatformId,
} from './types.js';

interface KuaishouCommentCard {
  author: string;
  occurredAt: string;
  content: string;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
}

export class EngagementService {
  readonly engagementStore = new EngagementStore();

  constructor(
    private readonly browser: BrowserManager,
    private readonly appStore: Store,
  ) {}

  async status() {
    return this.engagementStore.read();
  }

  async scan(targets: PlatformId[] = [...platformIds]) {
    const startedAt = new Date().toISOString();
    const surfaces: EngagementSurfaceResult[] = [];
    for (const platform of targets) {
      try {
        surfaces.push(...await this.scanPlatform(platform));
      } catch (error) {
        const checkedAt = new Date().toISOString();
        surfaces.push(this.surface({
          platform,
          kind: 'comment',
          status: 'failed',
          checkedAt,
          pageUrl: platformConfigs[platform].homeUrl,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    const completedAt = new Date().toISOString();
    const report = await this.engagementStore.mergeReport({
      id: randomUUID(),
      startedAt,
      completedAt,
      surfaces,
    });
    const outcome = report.summary.failed
      ? 'warning'
      : report.summary.highPriority
        ? 'warning'
        : 'success';
    await this.appStore.addAudit({
      action: 'engagement.scan',
      subject: report.id,
      detail: `互动巡检完成：新增 ${report.summary.newItems} 条，高意向 ${report.summary.highPriority} 条，需人工处理 ${report.summary.manualRequired} 项。`,
      outcome,
    });
    return report;
  }

  private async scanPlatform(platform: PlatformId): Promise<EngagementSurfaceResult[]> {
    if (platform === 'douyin') return this.scanDouyin();
    if (platform === 'xiaohongshu') return this.scanXiaohongshu();
    if (platform === 'kuaishou') return this.scanKuaishou();
    return this.scanWechatChannels();
  }

  private async scanDouyin(): Promise<EngagementSurfaceResult[]> {
    const page = await this.browser.openTemporary(platformConfigs.douyin.homeUrl);
    try {
      await page.waitForTimeout(1_500);
      const checkedAt = new Date().toISOString();
      const body = await this.pageText(page);
      const status = this.loginStatus('douyin', page.url(), body);
      if (status !== 'success') {
        const screenshot = await this.capture(page, `douyin-${status}`);
        const message = status === 'logged_out'
          ? '抖音创作者中心登录已失效，需要重新扫码后才能检查评论和私信。'
          : '抖音要求额外安全验证，本次未读取互动。';
        return [
          this.surface({ platform: 'douyin', kind: 'comment', status, checkedAt, pageUrl: page.url(), message, screenshot }),
          this.surface({ platform: 'douyin', kind: 'message', status, checkedAt, pageUrl: page.url(), message, screenshot }),
        ];
      }

      const noNewComments = body.includes('暂无新的评论');
      const commentUnread = noNewComments ? 0 : this.matchCount(body, /(?:评论消息|新的评论)\s*\+?\s*(\d+)/);
      const messageUnread = this.matchCount(body, /私信消息\s*\+?\s*(\d+)/);
      const commentCandidates = noNewComments ? [] : await this.collectCandidates(page, /comment/i);
      const messageCandidates = (messageUnread ?? 0) > 0
        ? await this.collectCandidates(page, /message|private|interaction/i)
        : [];
      const commentItems = this.candidatesToItems('douyin', 'comment', commentCandidates, page.url(), checkedAt);
      const messageItems = this.candidatesToItems('douyin', 'message', messageCandidates, page.url(), checkedAt);
      return [
        this.surface({
          platform: 'douyin',
          kind: 'comment',
          status: commentItems.length || (commentUnread ?? 0) > 0 ? 'success' : 'empty',
          checkedAt,
          pageUrl: page.url(),
          unreadCount: commentUnread,
          items: commentItems,
          message: noNewComments ? '首页显示暂无新评论。' : '已读取抖音评论摘要。',
        }),
        this.surface({
          platform: 'douyin',
          kind: 'message',
          status: messageItems.length || (messageUnread ?? 0) > 0 ? 'success' : 'empty',
          checkedAt,
          pageUrl: page.url(),
          unreadCount: messageUnread,
          items: messageItems,
          message: messageUnread ? `首页显示 ${messageUnread} 条私信提醒，需人工打开会话确认。` : '未识别到新私信计数。',
        }),
      ];
    } finally {
      await page.close();
    }
  }

  private async scanXiaohongshu(): Promise<EngagementSurfaceResult[]> {
    const page = await this.browser.openTemporary(platformConfigs.xiaohongshu.homeUrl);
    try {
      await page.waitForTimeout(1_300);
      const checkedAt = new Date().toISOString();
      const body = await this.pageText(page);
      const login = this.loginStatus('xiaohongshu', page.url(), body);
      if (login !== 'success') {
        const screenshot = await this.capture(page, `xiaohongshu-${login}`);
        return [
          this.surface({ platform: 'xiaohongshu', kind: 'comment', status: login, checkedAt, pageUrl: page.url(), message: '小红书登录或验证状态不可用。', screenshot }),
          this.surface({ platform: 'xiaohongshu', kind: 'message', status: login, checkedAt, pageUrl: page.url(), message: '小红书登录或验证状态不可用。', screenshot }),
        ];
      }
      const commentCount = this.matchCount(body, /评论数\s*(\d+)/);
      return [
        this.surface({
          platform: 'xiaohongshu',
          kind: 'comment',
          status: (commentCount ?? 0) > 0 ? 'success' : 'empty',
          checkedAt,
          pageUrl: page.url(),
          unreadCount: commentCount,
          message: `创作平台近7日评论数：${commentCount ?? '未识别'}。网页端未提供独立评论列表入口。`,
        }),
        this.surface({
          platform: 'xiaohongshu',
          kind: 'message',
          status: 'manual_required',
          checkedAt,
          pageUrl: page.url(),
          message: '小红书创作服务平台网页端未提供私信列表，需在小红书 App 消息页复核。',
        }),
      ];
    } finally {
      await page.close();
    }
  }

  private async scanKuaishou(): Promise<EngagementSurfaceResult[]> {
    const page = await this.browser.openTemporary(platformConfigs.kuaishou.homeUrl);
    try {
      await page.waitForTimeout(1_300);
      const checkedAt = new Date().toISOString();
      const body = await this.pageText(page);
      const login = this.loginStatus('kuaishou', page.url(), body);
      if (login !== 'success') {
        const screenshot = await this.capture(page, `kuaishou-${login}`);
        return [
          this.surface({ platform: 'kuaishou', kind: 'comment', status: login, checkedAt, pageUrl: page.url(), message: '快手登录或验证状态不可用。', screenshot }),
          this.surface({ platform: 'kuaishou', kind: 'message', status: login, checkedAt, pageUrl: page.url(), message: '快手登录或验证状态不可用。', screenshot }),
        ];
      }
      const cards = await page.locator('.comments-item').evaluateAll((elements) => elements.map((element) => {
        const html = element as HTMLElement;
        return {
          author: html.querySelector('.username')?.textContent?.trim() ?? '',
          occurredAt: html.querySelector('.datetime')?.textContent?.trim() ?? '',
          content: html.querySelector('.comments-item-content')?.textContent?.trim() ?? '',
        };
      }));
      const items = (cards as KuaishouCommentCard[])
        .filter((card) => card.content)
        .map((card) => createEngagementItem({
          platform: 'kuaishou',
          kind: 'comment',
          author: card.author,
          content: card.content,
          occurredAt: parsePlatformDate(card.occurredAt),
          pageUrl: page.url(),
        }, checkedAt));
      return [
        this.surface({
          platform: 'kuaishou',
          kind: 'comment',
          status: items.length ? 'success' : 'empty',
          checkedAt,
          pageUrl: page.url(),
          items,
          message: items.length ? `已读取首页 ${items.length} 条最近评论。` : '快手首页未显示最近评论。',
        }),
        this.surface({
          platform: 'kuaishou',
          kind: 'message',
          status: 'manual_required',
          checkedAt,
          pageUrl: page.url(),
          message: '快手创作者网页端当前只提供评论管理，未识别到私信列表入口，需在快手 App 复核。',
        }),
      ];
    } finally {
      await page.close();
    }
  }

  private async scanWechatChannels(): Promise<EngagementSurfaceResult[]> {
    const page = await this.browser.openTemporary(platformConfigs.wechat_channels.homeUrl);
    try {
      await page.waitForTimeout(1_300);
      const checkedAt = new Date().toISOString();
      let body = await this.pageText(page);
      const login = this.loginStatus('wechat_channels', page.url(), body);
      if (login !== 'success') {
        const screenshot = await this.capture(page, `wechat-channels-${login}`);
        return [
          this.surface({ platform: 'wechat_channels', kind: 'comment', status: login, checkedAt, pageUrl: page.url(), message: '视频号登录或验证状态不可用。', screenshot }),
          this.surface({ platform: 'wechat_channels', kind: 'message', status: login, checkedAt, pageUrl: page.url(), message: '视频号登录或验证状态不可用。', screenshot }),
        ];
      }
      if (body.includes('互动管理') && !body.includes('暂时无法使用该功能')) {
        const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        if (viewport.width >= 800 && viewport.height >= 400) {
          await page.mouse.click(Math.min(100, viewport.width * 0.08), 260);
          await page.waitForTimeout(800);
          body = await this.pageText(page);
        }
      }
      const unavailable = body.includes('暂时无法使用该功能') || body.includes('申请认证');
      const status: EngagementSurfaceStatus = unavailable ? 'manual_required' : 'empty';
      const message = unavailable
        ? '视频号后台已显示“互动管理”，但当前账号提示功能暂不可用/待认证，需人工处理账号权限。'
        : '已打开视频号互动入口，未识别到可见的新条目。';
      const screenshot = unavailable ? await this.capture(page, 'wechat-channels-unavailable') : undefined;
      return [
        this.surface({ platform: 'wechat_channels', kind: 'comment', status, checkedAt, pageUrl: page.url(), message, screenshot }),
        this.surface({ platform: 'wechat_channels', kind: 'message', status, checkedAt, pageUrl: page.url(), message, screenshot }),
      ];
    } finally {
      await page.close();
    }
  }

  private loginStatus(platform: PlatformId, pageUrl: string, body: string): EngagementSurfaceStatus {
    const config = platformConfigs[platform];
    if (config.verificationMarkers.some((marker) => body.includes(marker))) return 'needs_verification';
    if (config.loginUrlFragments.some((fragment) => pageUrl.includes(fragment))) return 'logged_out';
    if (/(?:扫码|验证码|密码|手机号)登录/.test(body)
      && !/退出登录|内容管理|发布作品|笔记管理/.test(body)) return 'logged_out';
    return 'success';
  }

  private async pageText(page: Page): Promise<string> {
    const text = await page.locator('body').evaluateAll((elements) => elements
      .map((element) => (element as HTMLElement).innerText || element.textContent || '')
      .join('\n'));
    return text.replace(/\s+/g, ' ').trim().slice(0, 50_000);
  }

  private matchCount(body: string, pattern: RegExp): number | undefined {
    const value = body.match(pattern)?.[1];
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private async collectCandidates(page: Page, classPattern: RegExp): Promise<string[]> {
    const candidates = await page.locator('div, li, tr, [role="listitem"], [role="row"]').evaluateAll(
      (elements, patternSource) => {
        const pattern = new RegExp(patternSource, 'i');
        return elements.map((element) => {
          const html = element as HTMLElement;
          const rect = html.getBoundingClientRect();
          const style = window.getComputedStyle(html);
          return {
            className: typeof html.className === 'string' ? html.className : '',
            text: (html.innerText || html.textContent || '').trim().replace(/\s+/g, ' '),
            visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
          };
        }).filter((item) => item.visible && pattern.test(item.className)
          && item.text.length >= 2 && item.text.length <= 500)
          .map((item) => item.text)
          .slice(0, 200);
      },
      classPattern.source,
    );
    return [...new Set(candidates.map(normalizeEngagementText))];
  }

  private candidatesToItems(
    platform: PlatformId,
    kind: EngagementKind,
    candidates: string[],
    pageUrl: string,
    capturedAt: string,
  ): EngagementItem[] {
    const kindWords = kind === 'comment' ? /评论|回复/ : kind === 'message' ? /私信|消息|会话/ : /线索|客户|留资/;
    const boilerplate = /^(?:评论|评论管理|作品评论|私信管理|私信消息|消息|线索管理|暂无新的评论)$/;
    const useful = candidates.filter((text) => {
      if (boilerplate.test(text)) return false;
      const hasTime = /\d{1,2}[.\/-]\d{1,2}(?:\s+\d{1,2}:\d{2})?|刚刚|昨天|小时前|分钟前/.test(text);
      const hasIntent = /(?:报价|价格|预算|采购|加盟|开业|装修|改造|酒店|宾馆|民宿|联系|电话|微信|投影|安装|想了解)/.test(text);
      return (kindWords.test(text) && (hasTime || hasIntent)) || (kind === 'lead' && hasIntent);
    });
    return useful
      .map((content) => createEngagementItem({ platform, kind, content, pageUrl }, capturedAt))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 50);
  }

  private async capture(page: Page, label: string): Promise<string> {
    await fs.mkdir(engagementScreenshotDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(engagementScreenshotDir, `${timestamp}-${safeFilename(label)}.png`);
    await page.screenshot({ path: target, fullPage: false });
    return target;
  }

  private surface(input: {
    platform: PlatformId;
    kind: EngagementKind;
    status: EngagementSurfaceStatus;
    checkedAt: string;
    pageUrl: string;
    message: string;
    unreadCount?: number;
    items?: EngagementItem[];
    screenshot?: string;
  }): EngagementSurfaceResult {
    const items = input.items ?? [];
    return {
      ...input,
      items,
      visibleCount: items.length,
    };
  }
}
