import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { assertPublicFacingCopy } from './content-policy.js';
import { projectRoot } from './paths.js';
import { getDailySchedule, shanghaiDate } from './schedule.js';
import { platformIds, type AppState, type PlatformId, type PublishJob } from './types.js';

export const contentManifestSchema = z.object({
  kind: z.enum(['video', 'gallery']),
  watermarkFreeConfirmed: z.boolean().default(false),
  mediaPaths: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  targets: z.array(z.enum(platformIds)).min(1).default([...platformIds]),
});

export type ContentManifest = z.infer<typeof contentManifestSchema>;

export interface DailyPlan {
  date: string;
  manifestPath: string;
  manifest: ContentManifest;
  existingJob?: PublishJob;
  schedule: ReturnType<typeof getDailySchedule>;
}

async function walkManifestFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkManifestFiles(entryPath);
    return entry.isFile() && entry.name === 'manifest.json' ? [entryPath] : [];
  }));
  return nested.flat();
}

export async function loadContentManifest(manifestPath: string): Promise<ContentManifest> {
  const manifest = contentManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  assertPublicFacingCopy(manifest);
  return manifest;
}

function absoluteMediaPaths(manifest: ContentManifest): string[] {
  return manifest.mediaPaths.map((item) => path.isAbsolute(item) ? item : path.resolve(projectRoot, item));
}

export function matchingJob(
  state: AppState,
  manifestPath: string,
  manifest: ContentManifest,
  date?: string,
): PublishJob | undefined {
  const absoluteManifestPath = path.resolve(manifestPath);
  const mediaPaths = absoluteMediaPaths(manifest);
  return state.jobs.find((job) => {
    const sameSource = job.source?.manifestPath === absoluteManifestPath;
    const sameLegacyContent = job.baseCopy.title === manifest.title
      && job.mediaPaths.length === mediaPaths.length
      && job.mediaPaths.every((item, index) => item === mediaPaths[index]);
    const sameDate = !date || job.source?.workflowDate === date
      || shanghaiDate(new Date(job.createdAt)) === date;
    return (sameSource || sameLegacyContent) && sameDate;
  });
}

export async function resolveDailyPlan(
  state: AppState,
  requestedManifest?: string,
  date = shanghaiDate(),
  force = false,
): Promise<DailyPlan> {
  const candidates = requestedManifest
    ? [path.isAbsolute(requestedManifest) ? requestedManifest : path.resolve(projectRoot, requestedManifest)]
    : (await walkManifestFiles(path.join(projectRoot, 'content'))).sort();

  if (!candidates.length) throw new Error('content/ 中没有可用的 manifest.json 内容清单');

  for (const manifestPath of candidates) {
    const manifest = await loadContentManifest(manifestPath);
    const todayJob = matchingJob(state, manifestPath, manifest, date);
    if (todayJob) {
      return { date, manifestPath, manifest, existingJob: todayJob, schedule: getDailySchedule(date) };
    }

    const previousJob = matchingJob(state, manifestPath, manifest);
    if (!previousJob || force) {
      return { date, manifestPath, manifest, schedule: getDailySchedule(date) };
    }

    if (requestedManifest) {
      throw new Error(`内容清单已经用于任务 ${previousJob.id}；请换一条内容，确需重发时添加 --force`);
    }
  }

  throw new Error('没有未使用的内容清单。请先创建今天的新内容 manifest.json');
}

export function preparedPlatforms(job: PublishJob): PlatformId[] {
  return job.targets.filter((platform) => job.results.some((result) => (
    result.platform === platform && result.phase === 'prepare' && result.status === 'success'
  )));
}

export function publishedPlatforms(job: PublishJob): PlatformId[] {
  return job.targets.filter((platform) => job.results.some((result) => (
    result.platform === platform && result.phase === 'publish' && result.status === 'success'
  )));
}

export function assertPublishTime(job: PublishJob, platform: PlatformId, now = new Date()): void {
  const scheduledAt = job.schedule?.[platform]?.scheduledAt;
  if (scheduledAt && now.getTime() < new Date(scheduledAt).getTime()) {
    const localTime = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(scheduledAt));
    throw new Error(`${platform} 计划发布时间为 ${localTime}，尚未到点`);
  }
}
