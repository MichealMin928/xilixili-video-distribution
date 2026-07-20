import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BrowserManager } from '../browser/manager.js';
import { PlatformAdapter, type PublishOptions } from '../platforms/adapter.js';
import { platformConfigs } from '../platforms/config.js';
import { adaptCopy } from './copy.js';
import { assertPublicFacingCopy, assertWatermarkFreeVideo } from './content-policy.js';
import { projectRoot } from './paths.js';
import { createPublicationPlan, shanghaiDate } from './schedule.js';
import { Store } from './store.js';
import { platformIds, type PlatformId, type PlatformResult, type PublishJob } from './types.js';

const createJobSchema = z.object({
  kind: z.enum(['video', 'gallery']),
  watermarkFreeConfirmed: z.boolean().default(false),
  mediaPaths: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  targets: z.array(z.enum(platformIds)).min(1).default([...platformIds]),
  scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => shanghaiDate()),
  sourceManifest: z.string().min(1).optional(),
  createdBy: z.enum(['daily_cli', 'web', 'api']).optional(),
});

export type CreateJobInput = z.input<typeof createJobSchema>;

export class Orchestrator {
  readonly store = new Store();
  readonly browser = new BrowserManager();
  readonly adapters = Object.fromEntries(
    platformIds.map((id) => [id, new PlatformAdapter(this.browser, platformConfigs[id])]),
  ) as Record<PlatformId, PlatformAdapter>;
  private readonly prepareInFlight = new Map<string, Promise<PlatformResult[]>>();
  private readonly publishInFlight = new Map<string, Promise<PlatformResult[]>>();

  async createJob(input: CreateJobInput): Promise<PublishJob> {
    const parsed = createJobSchema.parse(input);
    assertWatermarkFreeVideo(parsed.kind, parsed.watermarkFreeConfirmed);
    const baseCopy = { title: parsed.title, body: parsed.body, hashtags: parsed.hashtags };
    assertPublicFacingCopy(baseCopy);
    const now = new Date().toISOString();
    const job: PublishJob = {
      id: `${now.slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      kind: parsed.kind,
      watermarkFreeConfirmed: parsed.kind === 'gallery' || parsed.watermarkFreeConfirmed,
      mediaPaths: parsed.mediaPaths.map((item) => path.isAbsolute(item) ? item : path.resolve(projectRoot, item)),
      baseCopy,
      variants: Object.fromEntries(
        platformIds.map((platform) => [platform, adaptCopy(baseCopy, platform)]),
      ) as PublishJob['variants'],
      targets: parsed.targets,
      schedule: createPublicationPlan(parsed.scheduleDate, parsed.targets),
      source: parsed.sourceManifest ? {
        manifestPath: path.isAbsolute(parsed.sourceManifest)
          ? parsed.sourceManifest
          : path.resolve(projectRoot, parsed.sourceManifest),
        workflowDate: parsed.scheduleDate,
        createdBy: parsed.createdBy ?? 'api',
      } : undefined,
      results: [],
    };

    await this.store.update((state) => state.jobs.unshift(job));
    await this.store.addAudit({
      action: 'job.created',
      subject: job.id,
      detail: `已创建${job.kind === 'video' ? '视频' : '图文'}任务，目标：${job.targets.map((id) => platformConfigs[id].shortName).join('、')}`,
      outcome: 'success',
    });
    return job;
  }

  async openLogin(platform: PlatformId) {
    const account = await this.adapters[platform].openLogin();
    await this.store.update((state) => { state.accounts[platform] = account; });
    await this.store.addAudit({
      action: 'account.login.opened',
      subject: platform,
      detail: `${platformConfigs[platform].shortName}登录页已打开`,
      outcome: 'info',
    });
    return account;
  }

  async checkLogin(platform: PlatformId) {
    const account = await this.adapters[platform].checkLogin();
    await this.store.update((state) => { state.accounts[platform] = account; });
    await this.store.addAudit({
      action: 'account.checked',
      subject: platform,
      detail: `${platformConfigs[platform].shortName}：${account.note}`,
      outcome: account.status === 'logged_in' ? 'success' : 'warning',
    });
    return account;
  }

  async prepare(jobId: string, targets?: PlatformId[]): Promise<PlatformResult[]> {
    const active = this.prepareInFlight.get(jobId);
    if (active) {
      await active.catch(() => undefined);
      return this.prepare(jobId, targets);
    }
    const pending = this.performPrepare(jobId, targets);
    this.prepareInFlight.set(jobId, pending);
    try {
      return await pending;
    } finally {
      if (this.prepareInFlight.get(jobId) === pending) this.prepareInFlight.delete(jobId);
    }
  }

  private async performPrepare(jobId: string, targets?: PlatformId[]): Promise<PlatformResult[]> {
    const job = await this.store.getJob(jobId);
    assertWatermarkFreeVideo(job.kind, job.watermarkFreeConfirmed);
    assertPublicFacingCopy(job.baseCopy);
    const requested = targets?.length ? targets : job.targets;
    const invalid = requested.filter((platform) => !job.targets.includes(platform));
    if (invalid.length) throw new Error(`以下平台不在任务 ${jobId} 的目标中：${invalid.join('、')}`);
    const alreadyPrepared = new Set(job.results
      .filter((result) => result.phase === 'prepare' && result.status === 'success')
      .map((result) => result.platform));
    const selected = requested.filter((platform) => !alreadyPrepared.has(platform));
    if (!selected.length) return [];
    await this.store.update((state) => {
      const current = state.jobs.find((item) => item.id === jobId)!;
      current.status = 'preparing';
      current.updatedAt = new Date().toISOString();
    });

    const results: PlatformResult[] = [];
    for (const platform of selected) {
      try {
        results.push(await this.adapters[platform].prepare(job));
      } catch (error) {
        const screenshot = await this.adapters[platform]
          .captureCurrent(`${job.id}-${platform}-prepare-error.png`)
          .catch(() => undefined);
        results.push({
          platform,
          phase: 'prepare' as const,
          status: 'failed' as const,
          at: new Date().toISOString(),
          screenshot,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.store.update((state) => {
      const current = state.jobs.find((item) => item.id === jobId)!;
      current.results.push(...results);
      const preparedTargets = new Set(current.results
        .filter((result) => result.phase === 'prepare' && result.status === 'success')
        .map((result) => result.platform));
      current.status = current.targets.every((platform) => preparedTargets.has(platform)) ? 'prepared' : 'partial';
      current.updatedAt = new Date().toISOString();
    });
    await this.store.addAudit({
      action: 'job.prepared',
      subject: jobId,
      detail: `预填完成：${results.filter((item) => item.status === 'success').length}/${results.length}`,
      outcome: results.every((item) => item.status === 'success') ? 'success' : 'warning',
    });
    return results;
  }

  async publish(
    jobId: string,
    confirmation: string,
    targets?: PlatformId[],
    options: PublishOptions = {},
  ): Promise<PlatformResult[]> {
    const active = this.publishInFlight.get(jobId);
    if (active) {
      await active.catch(() => undefined);
      return this.publish(jobId, confirmation, targets, options);
    }
    const pending = this.performPublish(jobId, confirmation, targets, options);
    this.publishInFlight.set(jobId, pending);
    try {
      return await pending;
    } finally {
      if (this.publishInFlight.get(jobId) === pending) this.publishInFlight.delete(jobId);
    }
  }

  private async performPublish(
    jobId: string,
    confirmation: string,
    targets?: PlatformId[],
    options: PublishOptions = {},
  ): Promise<PlatformResult[]> {
    if (confirmation !== jobId) throw new Error(`发布确认文字必须等于任务编号：${jobId}`);
    const job = await this.store.getJob(jobId);
    assertWatermarkFreeVideo(job.kind, job.watermarkFreeConfirmed);
    const requested = targets?.length ? targets : job.targets;
    const invalid = requested.filter((platform) => !job.targets.includes(platform));
    if (invalid.length) throw new Error(`以下平台不在任务 ${jobId} 的目标中：${invalid.join('、')}`);
    const immediatelyPublished = new Set(job.results
      .filter((result) => result.phase === 'publish' && result.status === 'success' && !result.scheduledAt)
      .map((result) => result.platform));
    const scheduled = new Set(job.results
      .filter((result) => result.phase === 'publish' && result.status === 'success' && result.scheduledAt)
      .map((result) => result.platform));
    const blockedScheduled = requested.filter((platform) => scheduled.has(platform)
      && !(platform === 'kuaishou' && options.convertScheduledToImmediate));
    if (blockedScheduled.length) {
      throw new Error(`以下平台已提交原生定时发布，不能重复提交：${blockedScheduled.join('、')}`);
    }
    const selected = requested.filter((platform) => !immediatelyPublished.has(platform));
    if (!selected.length) return [];

    await this.store.update((state) => {
      const current = state.jobs.find((item) => item.id === jobId)!;
      current.status = 'publishing';
      current.updatedAt = new Date().toISOString();
    });

    const results: PlatformResult[] = [];
    for (const platform of selected) {
      try {
        results.push(await this.adapters[platform].publish(job, options));
      } catch (error) {
        const screenshot = await this.adapters[platform]
          .captureCurrent(`${job.id}-${platform}-publish-error.png`)
          .catch(() => undefined);
        results.push({
          platform,
          phase: 'publish' as const,
          status: 'failed' as const,
          at: new Date().toISOString(),
          screenshot,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.store.update((state) => {
      const current = state.jobs.find((item) => item.id === jobId)!;
      current.results.push(...results);
      const publishedTargets = new Set(current.results
        .filter((result) => result.phase === 'publish' && result.status === 'success')
        .map((result) => result.platform));
      current.status = current.targets.every((platform) => publishedTargets.has(platform))
        ? 'published'
        : publishedTargets.size
          ? 'partial'
          : 'failed';
      current.updatedAt = new Date().toISOString();
    });
    await this.store.addAudit({
      action: 'job.published',
      subject: jobId,
      detail: `发布操作完成：${results.filter((item) => item.status === 'success').length}/${results.length}`,
      outcome: results.every((item) => item.status === 'success') ? 'success' : 'warning',
    });
    return results;
  }

  async scheduleNative(jobId: string, confirmation: string, platform: PlatformId) {
    if (confirmation !== jobId) throw new Error(`定时发布确认文字必须等于任务编号：${jobId}`);
    const job = await this.store.getJob(jobId);
    assertWatermarkFreeVideo(job.kind, job.watermarkFreeConfirmed);
    const result = await this.adapters[platform].scheduleNative(job);

    await this.store.update((state) => {
      const current = state.jobs.find((item) => item.id === jobId)!;
      current.results.push(result);
      if (result.status === 'success' && result.scheduledAt && current.schedule?.[platform]) {
        current.schedule[platform]!.scheduledAt = result.scheduledAt;
      }
      const publishedTargets = new Set(current.results
        .filter((item) => item.phase === 'publish' && item.status === 'success')
        .map((item) => item.platform));
      current.status = current.targets.every((target) => publishedTargets.has(target))
        ? 'published'
        : publishedTargets.size
          ? 'partial'
          : 'failed';
      current.updatedAt = new Date().toISOString();
    });
    await this.store.addAudit({
      action: 'job.native_scheduled',
      subject: jobId,
      detail: `${platformConfigs[platform].shortName}：${result.message}`,
      outcome: result.status === 'success' ? 'success' : 'warning',
    });
    return result;
  }
}
