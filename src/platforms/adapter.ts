import fs from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { adaptCopy, renderBody } from '../core/copy.js';
import { screenshotDir } from '../core/paths.js';
import type { AccountState, PlatformResult, PublishJob } from '../core/types.js';
import { BrowserManager } from '../browser/manager.js';
import type { PlatformConfig } from './config.js';

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return undefined;
}

async function waitForFirstVisible(page: Page, selectors: string[], timeout = 120_000): Promise<Locator | undefined> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const locator = await firstVisible(page, selectors);
    if (locator) return locator;
    await page.waitForTimeout(1_000);
  }
  return undefined;
}

export class PlatformAdapter {
  constructor(
    private readonly browser: BrowserManager,
    readonly config: PlatformConfig,
  ) {}

  async openLogin(): Promise<AccountState> {
    const page = await this.browser.open(this.config.id, this.config.homeUrl);
    return {
      platform: this.config.id,
      status: 'unknown',
      checkedAt: new Date().toISOString(),
      pageUrl: page.url(),
      note: '已打开登录页面，请在真实 Chrome 中完成扫码或短信验证。',
    };
  }

  async checkLogin(): Promise<AccountState> {
    const page = await this.browser.open(this.config.id, this.config.homeUrl);
    await page.waitForTimeout(1_500);
    const url = page.url();
    const body = (await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '')).slice(0, 12_000);
    const needsVerification = this.config.verificationMarkers.some((marker) => body.includes(marker));
    const onLoginUrl = this.config.loginUrlFragments.some((fragment) => url.includes(fragment));
    const obviousLoginPage = /扫码登录|手机号登录|验证码登录/.test(body) && !/退出登录|内容管理|发布作品/.test(body);

    const status = needsVerification
      ? 'needs_verification'
      : onLoginUrl || obviousLoginPage
        ? 'logged_out'
        : 'logged_in';

    return {
      platform: this.config.id,
      status,
      checkedAt: new Date().toISOString(),
      pageUrl: url,
      note: status === 'logged_in' ? '登录态有效' : '需要在 Chrome 中完成登录或安全验证',
    };
  }

  async prepare(job: PublishJob): Promise<PlatformResult> {
    // Re-apply live platform limits here so existing queued jobs also benefit
    // when a platform rule changes (for example, Kuaishou's four-topic cap).
    const copy = adaptCopy(job.variants[this.config.id], this.config.id);
    const page = await this.browser.open(this.config.id, this.config.publishUrls[job.kind]);
    await page.waitForTimeout(2_000);

    const login = await this.detectCurrentPageLogin(page);
    if (login !== 'logged_in') {
      return this.result('prepare', 'needs_verification', page, '请先在当前 Chrome 页面完成登录或安全验证。');
    }

    if (job.kind === 'gallery') {
      await this.selectGalleryMode(page);
    }

    const missing = [];
    for (const mediaPath of job.mediaPaths) {
      try {
        await fs.access(mediaPath);
      } catch {
        missing.push(mediaPath);
      }
    }
    if (missing.length) throw new Error(`素材文件不存在：${missing.join('、')}`);

    if (this.config.id === 'kuaishou' && job.kind === 'gallery') {
      await this.uploadKuaishouGallery(page, job.mediaPaths);
    } else {
      const fileInput = await this.findFileInput(page, job.kind);
      if (!fileInput || await fileInput.count() === 0) {
        return this.result('prepare', 'needs_verification', page, '没有找到素材上传入口，页面可能已改版，请在当前页人工确认。');
      }
      await fileInput.setInputFiles(job.mediaPaths);
    }
    await this.waitForUploadSettled(
      page,
      job.kind,
      job.mediaPaths.length,
      job.kind === 'video' ? 300_000 : 180_000,
    );

    const requiresTitleField = this.config.id !== 'kuaishou';
    const title = requiresTitleField
      ? await waitForFirstVisible(page, this.config.titleSelectors, 90_000)
      : undefined;
    if (title && copy.title) await title.fill(copy.title);

    const body = await waitForFirstVisible(page, this.config.bodySelectors, 15_000);
    if (body) {
      const renderedBody = renderBody(copy, this.config.id);
      const value = requiresTitleField ? renderedBody : `${copy.title}\n\n${renderedBody}`;
      await body.fill(value);
    }

    const screenshot = await this.capture(page, `${job.id}-${this.config.id}-prepared.png`);
    await page.bringToFront();
    const missingFields = [requiresTitleField && !title && '标题', !body && '正文'].filter(Boolean).join('、');
    return this.result(
      'prepare',
      missingFields ? 'needs_verification' : 'success',
      page,
      missingFields
        ? `素材上传后未识别到${missingFields}输入区，请在当前页检查。`
        : '素材和文案已预填，停在发布按钮前。',
      screenshot,
    );
  }

  async publish(job: PublishJob): Promise<PlatformResult> {
    const page = await this.browser.getPlatformPage(this.config.id);
    await page.bringToFront();

    if (this.config.id === 'kuaishou' && job.kind === 'gallery') {
      await this.ensureKuaishouGalleryMusic(page);
    }

    let button: Locator | undefined;
    for (const name of this.config.publishButtonNames) {
      const candidate = page.getByRole('button', { name }).last();
      if (await candidate.isVisible().catch(() => false)) {
        button = candidate;
        break;
      }
    }

    if (!button) {
      const candidates = page.locator(
        'button, [role="button"], [class*="button-primary"], [class*="publish"], [class*="submit"]',
      );
      const count = await candidates.count();
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        const text = (await candidate.innerText().catch(() => '')).trim();
        const matches = this.config.publishButtonNames.some((name) => name.test(text));
        if (matches && await candidate.isVisible().catch(() => false)) {
          button = candidate;
          break;
        }
      }
    }

    if (!button) {
      return this.result('publish', 'needs_verification', page, '没有识别到可用的发布按钮，请在当前页人工确认。');
    }

    const beforeUrl = page.url();
    await button.click();
    await page.waitForTimeout(5_000);
    const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 20_000);
    const afterUrl = page.url();
    const verification = this.config.verificationMarkers.some((marker) => bodyText.includes(marker));
    const failure = /发布失败|发表失败|提交失败|请完善|不能为空|请上传|上传中/.test(bodyText);
    const success = /发布成功|发表成功|提交成功|已发布|已发表|正在审核|审核中/.test(bodyText)
      || /finderNewLifePostList|content\/manage|article\/manage/.test(afterUrl)
      || (afterUrl !== beforeUrl && !/publish|create|upload/.test(afterUrl));
    const screenshot = await this.capture(page, `${job.id}-${this.config.id}-published.png`);

    return this.result(
      'publish',
      verification || failure || !success ? 'needs_verification' : 'success',
      page,
      verification
        ? '平台要求额外安全验证，请在当前页完成。'
        : failure
          ? '已点击发布，但页面提示仍需完善内容或等待素材完成，请检查当前页。'
          : success
            ? '平台已显示发布成功、进入审核或跳转到作品管理页。'
            : '已点击发布，但未出现明确的成功状态，请检查当前页。',
      screenshot,
    );
  }

  async captureCurrent(filename: string): Promise<string> {
    const page = await this.browser.getPlatformPage(this.config.id);
    return this.capture(page, filename);
  }

  async diagnostics() {
    const page = await this.browser.getPlatformPage(this.config.id);
    const engagementLinks = await page.locator('a').evaluateAll((elements) => elements
      .map((element) => {
        const anchor = element as HTMLAnchorElement;
        const rect = anchor.getBoundingClientRect();
        const style = window.getComputedStyle(anchor);
        return {
          text: (anchor.innerText || anchor.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          href: anchor.href,
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        };
      })
      .filter((item) => item.visible && /\u8bc4\u8bba|\u4e92\u52a8|\u79c1\u4fe1|\u6d88\u606f|\u7ebf\u7d22|\u54a8\u8be2|\u5ba2\u670d/.test(item.text))
      .slice(0, 50));
    const engagementControls = await page.locator('a, button, [role="button"], [role="menuitem"], div, span').evaluateAll(
      (elements) => elements
        .map((element, index) => {
          const html = element as HTMLElement;
          const rect = html.getBoundingClientRect();
          const style = window.getComputedStyle(html);
          const text = (html.innerText || html.textContent || '').trim().replace(/\s+/g, ' ');
          return {
            index,
            tagName: html.tagName.toLowerCase(),
            text,
            href: (html as HTMLAnchorElement).href ?? '',
            role: html.getAttribute('role') ?? '',
            className: typeof html.className === 'string' ? html.className : '',
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        })
        .filter((item) => item.visible && item.text.length <= 24
          && /\u8bc4\u8bba|\u4e92\u52a8|\u79c1\u4fe1|\u6d88\u606f|\u7ebf\u7d22|\u54a8\u8be2|\u5ba2\u670d/.test(item.text))
        .slice(0, 80),
    );
    const navigationControls = await page.locator('a, button, [role="button"], [role="menuitem"], div, span').evaluateAll(
      (elements) => elements
        .map((element, index) => {
          const html = element as HTMLElement;
          const rect = html.getBoundingClientRect();
          const style = window.getComputedStyle(html);
          const text = (html.innerText || html.textContent || '').trim().replace(/\s+/g, ' ');
          return {
            index,
            tagName: html.tagName.toLowerCase(),
            text,
            href: (html as HTMLAnchorElement).href ?? '',
            role: html.getAttribute('role') ?? '',
            className: typeof html.className === 'string' ? html.className : '',
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        })
        .filter((item) => item.visible && item.rect.x < 260 && item.text.length > 0 && item.text.length <= 20)
        .slice(0, 120),
    );
    const fileInputs = await page.locator('input[type="file"]').evaluateAll((elements) => elements.map((element, index) => {
      const input = element as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      return {
        index,
        accept: input.accept,
        multiple: input.multiple,
        disabled: input.disabled,
        className: input.className,
        parentClassName: input.parentElement?.className ?? '',
        parentText: input.parentElement?.textContent?.trim().slice(0, 80) ?? '',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }));
    const fields = await page.locator('input, textarea, [contenteditable]').evaluateAll((elements) => elements.map((element, index) => {
      const html = element as HTMLElement;
      const input = element as HTMLInputElement;
      const rect = html.getBoundingClientRect();
      return {
        index,
        tagName: html.tagName.toLowerCase(),
        type: input.type ?? '',
        name: input.name ?? '',
        placeholder: input.placeholder ?? html.getAttribute('data-placeholder') ?? '',
        value: input.value ?? html.textContent ?? '',
        readOnly: input.readOnly ?? false,
        disabled: input.disabled ?? false,
        contentEditable: html.getAttribute('contenteditable') ?? '',
        role: html.getAttribute('role') ?? '',
        className: typeof html.className === 'string' ? html.className : '',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }));
    const actionControls = await page.locator('button, [role="button"], a, div, span').evaluateAll((elements) => elements
      .map((element, index) => {
        const html = element as HTMLElement;
        const rect = html.getBoundingClientRect();
        const text = (html.innerText || html.textContent || '').trim().replace(/\s+/g, ' ');
        const style = window.getComputedStyle(html);
        return {
          index,
          tagName: html.tagName.toLowerCase(),
          text,
          role: html.getAttribute('role') ?? '',
          className: typeof html.className === 'string' ? html.className : '',
          disabled: (html as HTMLButtonElement).disabled ?? false,
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      })
      .filter((item) => item.visible && item.text.length <= 24 && /发布|发表/.test(item.text))
      .slice(0, 50));
    const musicControls = await page.locator('button, [role="button"], a, div, span').evaluateAll((elements) => elements
      .map((element, index) => {
        const html = element as HTMLElement;
        const rect = html.getBoundingClientRect();
        const text = (html.innerText || html.textContent || '').trim().replace(/\s+/g, ' ');
        const style = window.getComputedStyle(html);
        const ancestors = Array.from({ length: 5 }, (_, depth) => {
          let current: HTMLElement | null = html;
          for (let step = 0; step < depth; step += 1) current = current?.parentElement ?? null;
          if (!current) return undefined;
          return {
            depth,
            tagName: current.tagName.toLowerCase(),
            className: typeof current.className === 'string' ? current.className : '',
            role: current.getAttribute('role') ?? '',
          };
        }).filter(Boolean);
        return {
          index,
          tagName: html.tagName.toLowerCase(),
          text,
          className: typeof html.className === 'string' ? html.className : '',
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          ancestors,
        };
      })
      .filter((item) => item.visible && item.text.length <= 24 && /音乐|使用|添加/.test(item.text))
      .slice(0, 80));
    return {
      platform: this.config.id,
      pageUrl: page.url(),
      engagementLinks,
      engagementControls,
      navigationControls,
      fileInputs,
      fields,
      actionControls,
      musicControls,
    };
  }

  async openNativeSchedulePicker() {
    const page = await this.browser.getPlatformPage(this.config.id);
    await page.bringToFront();
    let opened = false;

    if (this.config.id === 'xiaohongshu') {
      const switchCard = page.locator('.post-time-wrapper .custom-switch-card').last();
      if (await switchCard.isVisible().catch(() => false)) {
        await switchCard.scrollIntoViewIfNeeded();
        const switchInput = page.locator('.post-time-wrapper input[type="checkbox"]').last();
        let checked = await switchInput.evaluate((element) => (element as HTMLInputElement).checked).catch(() => false);
        if (!checked) {
          const box = await switchCard.boundingBox();
          if (box) await switchCard.click({ position: { x: Math.max(1, box.width - 24), y: box.height / 2 } });
          checked = await switchInput.evaluate((element) => (element as HTMLInputElement).checked).catch(() => false);
        }
        if (!checked && await switchInput.count() > 0) {
          await switchInput.evaluate((element) => (element as HTMLInputElement).click());
          checked = await switchInput.evaluate((element) => (element as HTMLInputElement).checked).catch(() => false);
        }
        opened = checked;
      }
    } else {
      const label = this.config.id === 'wechat_channels' ? '定时' : '定时发布';
      const candidates = page.getByText(label, { exact: true });
      const count = await candidates.count();
      for (let index = count - 1; index >= 0; index -= 1) {
        const candidate = candidates.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        await candidate.evaluate((element) => {
          const clickable = element.closest(
            'label, button, [role="radio"], [role="button"], [class*="radio"], [class*="switch"], [class*="schedule"], [class*="time"]',
          ) as HTMLElement | null;
          (clickable ?? element as HTMLElement).click();
        });
        opened = true;
        break;
      }
    }

    if (!opened) throw new Error(`${this.config.shortName}未找到原生定时发布入口。`);
    await page.waitForTimeout(1_000);

    const fields = await page.locator('input, textarea, [contenteditable]').evaluateAll((elements) => elements
      .map((element, index) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const rect = html.getBoundingClientRect();
        const style = window.getComputedStyle(html);
        return {
          index,
          tagName: html.tagName.toLowerCase(),
          type: input.type ?? '',
          name: input.name ?? '',
          placeholder: input.placeholder ?? html.getAttribute('data-placeholder') ?? '',
          value: input.value ?? html.textContent ?? '',
          readOnly: input.readOnly ?? false,
          disabled: input.disabled ?? false,
          role: html.getAttribute('role') ?? '',
          className: typeof html.className === 'string' ? html.className : '',
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      })
      .filter((item) => item.visible));
    const controls = await page.locator('button, [role="button"], [role="radio"], label, div, span, li').evaluateAll(
      (elements) => elements
        .map((element, index) => {
          const html = element as HTMLElement;
          const rect = html.getBoundingClientRect();
          const style = window.getComputedStyle(html);
          const text = (html.innerText || html.textContent || '').trim().replace(/\s+/g, ' ');
          return {
            index,
            tagName: html.tagName.toLowerCase(),
            text,
            role: html.getAttribute('role') ?? '',
            className: typeof html.className === 'string' ? html.className : '',
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        })
        .filter((item) => item.visible && item.text.length > 0 && item.text.length <= 40
          && /定时|发布时间|发表时间|选择时间|日期|今天|明天|\d{1,2}:\d{2}|\d{4}-\d{1,2}-\d{1,2}/.test(item.text))
        .slice(0, 160),
    );
    const screenshot = await this.capture(page, `native-schedule-${this.config.id}.png`);
    return { platform: this.config.id, pageUrl: page.url(), fields, controls, screenshot };
  }

  async scheduleNative(job: PublishJob): Promise<PlatformResult> {
    const page = await this.browser.getPlatformPage(this.config.id);
    await page.bringToFront();

    if (this.config.id === 'kuaishou' && job.kind === 'gallery') {
      await this.ensureKuaishouGalleryMusic(page);
    }

    const schedule = await this.openNativeSchedulePicker();
    const timeField = schedule.fields.find((field) =>
      /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(field.value)
      && (this.config.id === 'xiaohongshu'
        || /时间|date|time|picker/i.test(`${field.placeholder} ${field.className}`)));
    if (!timeField) {
      return this.result(
        'publish',
        'needs_verification',
        page,
        '已打开平台原生定时设置，但未识别到已选时间，为避免误发已停在提交前。',
        schedule.screenshot,
      );
    }

    const selectedAt = timeField.value.slice(0, 19);
    const selectedAtIso = `${selectedAt.replace(' ', 'T')}${selectedAt.length === 16 ? ':00' : ''}+08:00`;
    const parsed = new Date(selectedAtIso);
    const workflowDate = job.source?.workflowDate ?? job.schedule?.[this.config.id]?.scheduledAt.slice(0, 10);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now() + 5 * 60_000) {
      return this.result('publish', 'needs_verification', page, `平台选中时间无效或距现在太近：${selectedAt}。`);
    }
    if (workflowDate && selectedAt.slice(0, 10) !== workflowDate) {
      return this.result('publish', 'needs_verification', page, `平台默认时间不在今天：${selectedAt}，已停在提交前。`);
    }

    const beforeUrl = page.url();
    let button: Locator | undefined;
    let clickedDirectly = false;
    if (this.config.id === 'xiaohongshu') {
      // Xiaohongshu renders the sticky footer submit control outside the
      // accessible editor tree. Its position is stable relative to the
      // maximized viewport after the scheduling row has been scrolled in.
      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      await page.mouse.click(Math.round(viewport.width * 0.474), Math.round(viewport.height - 54));
      clickedDirectly = true;
    }
    const scheduleButtonNames = [...this.config.publishButtonNames, /^定时发布$/, /^定时发表$/];
    for (const name of clickedDirectly ? [] : scheduleButtonNames) {
      const candidate = page.getByRole('button', { name }).last();
      if (await candidate.isVisible().catch(() => false)) {
        button = candidate;
        break;
      }
    }
    if (!clickedDirectly && !button && this.config.id === 'xiaohongshu') {
      const candidates = page.getByText('定时发布', { exact: true });
      const count = await candidates.count();
      let bestY = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        const box = await candidate.boundingBox();
        if (box && box.y > bestY) {
          bestY = box.y;
          button = candidate;
        }
      }
    }
    if (!clickedDirectly && !button) {
      const candidates = page.locator('button, [role="button"], [class*="button-primary"], [class*="publish"], [class*="submit"]');
      const count = await candidates.count();
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        const text = (await candidate.innerText().catch(() => '')).trim();
        if (scheduleButtonNames.some((name) => name.test(text))
          && await candidate.isVisible().catch(() => false)) {
          button = candidate;
          break;
        }
      }
    }
    if (!clickedDirectly && !button) {
      return this.result('publish', 'needs_verification', page, '未识别到定时提交按钮，已停在提交前。');
    }

    if (button) await button.click();
    await page.waitForTimeout(1_500);
    const confirmButtons = page.getByRole('button', { name: /^确认发布$|^确定$|^确认$/ });
    const confirmCount = await confirmButtons.count();
    for (let index = confirmCount - 1; index >= 0; index -= 1) {
      const confirm = confirmButtons.nth(index);
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        break;
      }
    }
    await page.waitForTimeout(5_000);

    const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 25_000);
    const afterUrl = page.url();
    const verification = this.config.verificationMarkers.some((marker) => bodyText.includes(marker));
    const failure = /发布失败|发表失败|提交失败|请完善|不能为空|请上传|上传中/.test(bodyText);
    const success = /定时发布成功|定时发表成功|预约成功|已定时|发布成功|发表成功|提交成功|正在审核|审核中/.test(bodyText)
      || /published=true|finderNewLifePostList|content\/manage|article\/manage|publish\/success/.test(afterUrl)
      || (afterUrl !== beforeUrl && !/publish|create|upload/.test(afterUrl));
    const screenshot = await this.capture(page, `${job.id}-${this.config.id}-scheduled.png`);

    return this.result(
      'publish',
      verification || failure || !success ? 'needs_verification' : 'success',
      page,
      verification
        ? `已选择 ${selectedAt}，但平台要求额外安全验证。`
        : failure
          ? `已选择 ${selectedAt}，但平台提示仍需完善内容。`
          : success
            ? `平台已接收原生定时发布，页面选中时间为 ${selectedAt}。`
            : `已点击定时提交（${selectedAt}），但未出现明确成功状态，请检查当前页。`,
      screenshot,
      selectedAtIso,
    );
  }

  private async detectCurrentPageLogin(page: Page): Promise<AccountState['status']> {
    const url = page.url();
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 10_000);
    if (this.config.verificationMarkers.some((marker) => body.includes(marker))) return 'needs_verification';
    if (this.config.loginUrlFragments.some((fragment) => url.includes(fragment))) return 'logged_out';
    if (/扫码登录|手机号登录|验证码登录/.test(body) && !/发布作品|内容管理/.test(body)) return 'logged_out';
    return 'logged_in';
  }

  private async selectGalleryMode(page: Page): Promise<void> {
    const candidates = ['上传图文', '发布图文', '图文'];
    for (const name of candidates) {
      const tabs = page.getByText(name, { exact: true });
      const count = await tabs.count();
      for (let index = 0; index < count; index += 1) {
        const tab = tabs.nth(index);
        if (await tab.isVisible().catch(() => false)) {
          await tab.evaluate((element) => {
            const clickable = element.closest('button, [role="tab"], li, [class*="tab"]') as HTMLElement | null;
            (clickable ?? element as HTMLElement).click();
          });
          await page.waitForTimeout(1_000);
          return;
        }
      }
    }
  }

  private async waitForUploadSettled(
    page: Page,
    kind: PublishJob['kind'],
    mediaCount: number,
    timeout: number,
  ): Promise<void> {
    const started = Date.now();
    const gallerySettleDelay = kind === 'gallery' && mediaCount > 1
      ? Math.min(12_000, mediaCount * 2_000)
      : 1_500;
    await page.waitForTimeout(gallerySettleDelay);
    while (Date.now() - started < timeout) {
      const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 20_000);
      if (/上传失败|上传出错|上传异常|文件不符合要求/.test(body)) {
        throw new Error('平台显示素材上传失败，请检查素材格式或网络后重试。');
      }
      const strongBusy = /取消上传|正在上传/.test(body);
      const weakBusy = /上传中/.test(body);
      const uploadMarkers = page.getByText(/上传中|正在上传|取消上传/);
      let visibleBusy = false;
      const markerCount = await uploadMarkers.count();
      for (let index = 0; index < markerCount; index += 1) {
        if (await uploadMarkers.nth(index).isVisible().catch(() => false)) {
          visibleBusy = true;
          break;
        }
      }
      const editorReady = Boolean(await firstVisible(page, [
        ...this.config.titleSelectors,
        ...this.config.bodySelectors,
      ]));
      const uploadComplete = kind === 'gallery'
        ? !strongBusy && !weakBusy && !visibleBusy
        : !strongBusy && (!weakBusy || editorReady);
      if (uploadComplete) {
        if (kind === 'gallery') await page.waitForTimeout(5_000);
        return;
      }
      await page.waitForTimeout(1_000);
    }
    throw new Error(`等待素材上传完成超时（${Math.round(timeout / 1000)} 秒）。`);
  }

  private async findFileInput(page: Page, kind: PublishJob['kind']): Promise<Locator | undefined> {
    const selectors = kind === 'gallery'
      ? [
          'input[type="file"][accept*="image"]',
          'input[type="file"][accept*=".png"]',
          'input[type="file"][accept*=".jpg"]',
        ]
      : [
          'input[type="file"][accept*="video"]',
          'input[type="file"][accept*=".mp4"]',
          'input[type="file"][accept*=".mov"]',
        ];

    const started = Date.now();
    while (Date.now() - started < 30_000) {
      for (const selector of selectors) {
        const candidates = page.locator(selector);
        if (await candidates.count() > 0) return candidates.last();
      }
      await page.waitForTimeout(500);
    }
    const fallback = page.locator('input[type="file"]');
    return await fallback.count() > 0 ? fallback.last() : undefined;
  }

  private async uploadKuaishouGallery(page: Page, mediaPaths: string[]): Promise<void> {
    const uploadButton = page.getByText('上传图片', { exact: true }).last();
    if (!await uploadButton.isVisible().catch(() => false)) {
      throw new Error('快手图文页未找到可见的“上传图片”按钮。');
    }
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 30_000 });
    await uploadButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(mediaPaths);
  }

  private async ensureKuaishouGalleryMusic(page: Page): Promise<void> {
    const drawer = page.locator('.ant-drawer-open').filter({ hasText: '选择音乐' }).first();
    if (!await drawer.isVisible().catch(() => false)) {
      const addMusicButton = page
        .locator('div[class*="_button_"]')
        .filter({ hasText: /^添加音乐$/ })
        .first();
      if (!await addMusicButton.isVisible().catch(() => false)) {
        throw new Error('快手图文页未找到“添加音乐”，已停止发布，请人工确认配乐。');
      }

      await addMusicButton.scrollIntoViewIfNeeded();
      await addMusicButton.click();
      await page.waitForTimeout(1_500);
    }

    const activeDrawer = page.locator('.ant-drawer-open').filter({ hasText: '选择音乐' }).first();
    try {
      const search = activeDrawer
        .locator('input[placeholder*="搜索音乐"], input[placeholder*="歌手"], input[placeholder*="歌词"]')
        .first();
      if (await search.isVisible().catch(() => false)) {
        await search.fill('轻音乐');
        await search.press('Enter');
        await page.waitForTimeout(2_000);
      }

      let track = activeDrawer
        .locator('div[class*="_item_"]')
        .filter({ hasText: /秋恋.*钢琴版纯音乐/ })
        .first();
      if (!await track.isVisible().catch(() => false)) {
        track = activeDrawer
          .locator('div[class*="_item_"], li, [role="option"]')
          .filter({ hasText: /纯音乐|钢琴|轻音乐|舒缓/ })
          .first();
      }
      if (!await track.isVisible().catch(() => false)) {
        throw new Error('快手配乐列表未找到已批准的轻音乐，已停止发布。');
      }

      await track.scrollIntoViewIfNeeded();
      await track.hover();
      await page.waitForTimeout(500);

      const useButton = track
        .locator('button, [role="button"], div[class*="_button_"]')
        .filter({ hasText: /^使用$/ })
        .first();
      if (await useButton.isVisible().catch(() => false)) {
        await useButton.click();
      } else {
        const box = await track.boundingBox();
        if (!box) throw new Error('快手配乐条目不可点击，已停止发布。');
        await track.click({ position: { x: Math.max(1, box.width - 36), y: box.height / 2 } });
      }
      await page.waitForTimeout(1_500);
    } finally {
      if (await activeDrawer.isVisible().catch(() => false)) {
        const closeButton = activeDrawer.locator('.ant-drawer-close, button[aria-label="Close"]').first();
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click();
        } else {
          await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(500);
      }
    }
  }

  private async capture(page: Page, filename: string): Promise<string> {
    await fs.mkdir(screenshotDir, { recursive: true });
    const target = path.join(screenshotDir, filename);
    await page.screenshot({ path: target, fullPage: false });
    return target;
  }

  private result(
    phase: PlatformResult['phase'],
    status: PlatformResult['status'],
    page: Page,
    message: string,
    screenshot?: string,
    scheduledAt?: string,
  ): PlatformResult {
    return {
      platform: this.config.id,
      phase,
      status,
      at: new Date().toISOString(),
      scheduledAt,
      pageUrl: page.url(),
      screenshot,
      message,
    };
  }
}
