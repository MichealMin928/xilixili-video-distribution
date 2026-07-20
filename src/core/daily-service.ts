import path from 'node:path';
import { Orchestrator } from './orchestrator.js';
import {
  assertPublishTime,
  preparedPlatforms,
  publishedPlatforms,
  resolveDailyPlan,
} from './daily.js';
import { projectRoot } from './paths.js';
import { shanghaiDate } from './schedule.js';
import type { PlatformId } from './types.js';

export class DailyService {
  constructor(private readonly orchestrator: Orchestrator) {}

  async status() {
    const today = shanghaiDate();
    const state = await this.orchestrator.store.read();
    const jobs = state.jobs.filter((job) => job.source?.workflowDate === today
      || shanghaiDate(new Date(job.createdAt)) === today);
    return {
      date: today,
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.baseCopy.title,
        status: job.status,
        manifestPath: job.source?.manifestPath,
        prepared: preparedPlatforms(job),
        published: publishedPlatforms(job),
        schedule: job.schedule,
      })),
    };
  }

  async plan(requestedManifest?: string, force = false) {
    const plan = await resolveDailyPlan(
      await this.orchestrator.store.read(),
      requestedManifest,
      shanghaiDate(),
      force,
    );
    return {
      date: plan.date,
      manifestPath: path.relative(projectRoot, plan.manifestPath),
      title: plan.manifest.title,
      watermarkFreeConfirmed: plan.manifest.watermarkFreeConfirmed,
      targets: plan.manifest.targets,
      existingJobId: plan.existingJob?.id,
      schedule: plan.schedule,
    };
  }

  async start(requestedManifest?: string, force = false) {
    const plan = await resolveDailyPlan(
      await this.orchestrator.store.read(),
      requestedManifest,
      shanghaiDate(),
      force,
    );
    const job = plan.existingJob ?? await this.orchestrator.createJob({
      ...plan.manifest,
      scheduleDate: plan.date,
      sourceManifest: plan.manifestPath,
      createdBy: 'daily_cli',
    });
    const alreadyPrepared = new Set(preparedPlatforms(job));
    const pendingTargets = job.targets.filter((platform) => !alreadyPrepared.has(platform));
    const results = pendingTargets.length ? await this.orchestrator.prepare(job.id, pendingTargets) : [];
    const retryTargets = results
      .filter((result) => result.status !== 'success')
      .map((result) => result.platform);
    return {
      date: plan.date,
      jobId: job.id,
      title: job.baseCopy.title,
      reused: Boolean(plan.existingJob),
      preparedBefore: [...alreadyPrepared],
      preparedNow: results,
      retryTargets,
      next: retryTargets.length
        ? `只需处理以下未成功平台：${retryTargets.join('、')}；再次运行时不会触碰已成功平台。`
        : pendingTargets.length
          ? '本次待处理平台已完成预填；已成功平台会保留原页面。'
          : '所有目标平台此前均已预填成功，本次未打开或刷新任何平台页面。',
    };
  }

  async publish(jobId: string, platform: PlatformId) {
    const job = await this.orchestrator.store.getJob(jobId);
    if (!job.targets.includes(platform)) throw new Error(`${platform} 不在任务 ${jobId} 的目标平台中`);
    if (publishedPlatforms(job).includes(platform)) throw new Error(`${platform} 已发布成功，不重复提交`);
    if (!preparedPlatforms(job).includes(platform)) throw new Error(`${platform} 尚未预填成功，不能发布`);
    assertPublishTime(job, platform);
    return this.orchestrator.publish(jobId, jobId, [platform]);
  }
}
