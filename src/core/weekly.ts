import fs from 'node:fs/promises';
import path from 'node:path';
import type { PlatformId, PublicationPlan } from './types.js';

export const weeklyPublishingDays = ['TU', 'FR'] as const;

export const weeklyPublishingSlots: Record<PlatformId, string> = {
  wechat_channels: '12:10',
  kuaishou: '20:05',
  douyin: '20:35',
  xiaohongshu: '21:05',
};

export interface WeeklyStatusJob {
  id: string;
  manifestPath?: string;
  prepared: PlatformId[];
  published: PlatformId[];
  schedule?: PublicationPlan;
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function findManifestFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findManifestFiles(entryPath);
    return entry.isFile() && entry.name === 'manifest.json' ? [entryPath] : [];
  }));
  return nested.flat().sort();
}

export async function isApprovedManifest(manifestPath: string, approvedRoot: string): Promise<boolean> {
  if (!isPathInside(approvedRoot, manifestPath)) return false;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    return manifest.approvedForAutoPublish === true;
  } catch {
    return false;
  }
}

export async function eligibleWeeklyJobs(
  jobs: WeeklyStatusJob[],
  platform: PlatformId,
  approvedRoot: string,
): Promise<WeeklyStatusJob[]> {
  const eligible = [];
  for (const job of jobs) {
    if (!job.manifestPath || !await isApprovedManifest(job.manifestPath, approvedRoot)) continue;
    if (!job.prepared.includes(platform) || job.published.includes(platform)) continue;
    if (!job.schedule?.[platform]) continue;
    eligible.push(job);
  }
  return eligible;
}
