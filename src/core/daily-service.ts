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
    const accountChecks = [];
    for (const platform of plan.manifest.targets) {
      accountChecks.push(await this.orchestrator.checkLogin(platform));
    }
    const unavailable = accountChecks.filter((account) => account.status !== 'logged_in');
    if (unavailable.length) {
      throw new Error(`以下平台需要先人工登录或验证：${unavailable.map((item) => item.platform).join('、')}`);
    }

    const job = plan.existingJob ?? await this.orchestrator.createJob({
      ...plan.manifest,
      scheduleDate: plan.date,
      sourceManifest: plan.manifestPath,
      createdBy: 'daily_cli',
    });
    const alreadyPrepared = new Set(preparedPlatforms(job));
    const pendingTargets = job.targets.filter((platform) => !alreadyPrepared.has(platform));
    const results = pendingTargets.length ? await this.orchestrator.prepare(job.id, pendingTargets) : [];
    return {
      date: plan.date,
      jobId: job.id,
      title: job.baseCopy.title,
      reused: Boolean(plan.existingJob),
      preparedBefore: [...alreadyPrepared],
      preparedNow: results,
      next: '保持运营台服务运行并检查四个平台预览；到计划时间后手工发布指定平台。',
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
