import path from 'node:path';
import { projectRoot } from '../core/paths.js';
import { platformIds, type PlatformId } from '../core/types.js';
import {
  eligibleWeeklyJobs,
  findManifestFiles,
  isApprovedManifest,
  weeklyPublishingDays,
  weeklyPublishingSlots,
  type WeeklyStatusJob,
} from '../core/weekly.js';

const baseUrl = process.env.XILIXILI_API_URL ?? 'http://127.0.0.1:4317/api';
const approvedRoot = path.join(projectRoot, 'content', 'approved');

async function api<T>(apiPath: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${apiPath}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...options?.headers },
    });
  } catch {
    throw new Error('运营台服务未运行。请先运行 xilixili-service start。');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}

async function approvedManifests(): Promise<string[]> {
  const manifests = await findManifestFiles(approvedRoot);
  const approved = [];
  for (const manifestPath of manifests) {
    if (await isApprovedManifest(manifestPath, approvedRoot)) approved.push(manifestPath);
  }
  return approved;
}

async function prepare() {
  const candidates = await approvedManifests();
  if (!candidates.length) {
    throw new Error('content/approved/ 中没有已批准的 manifest.json，本次自动准备已停止。');
  }

  const rejected: string[] = [];
  for (const manifestPath of candidates) {
    const relative = path.relative(projectRoot, manifestPath);
    try {
      await api('/daily/plan', {
        method: 'POST',
        body: JSON.stringify({ manifestPath: relative, force: false }),
      });
    } catch (error) {
      rejected.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    return api('/daily/start', {
      method: 'POST',
      body: JSON.stringify({ manifestPath: relative, force: false }),
    });
  }
  throw new Error(`已批准队列中没有可用的新内容：\n${rejected.join('\n')}`);
}

interface DailyStatus {
  date: string;
  jobs: WeeklyStatusJob[];
}

interface PublishingState {
  jobs: Array<{ source?: { manifestPath: string } }>;
}

async function publish(platform: PlatformId) {
  const status = await api<DailyStatus>('/daily/status');
  const jobs = await eligibleWeeklyJobs(status.jobs, platform, approvedRoot);
  if (!jobs.length) {
    throw new Error(`${status.date} 没有可自动发布到 ${platform} 的已批准且预填成功任务。`);
  }
  if (jobs.length > 1) {
    throw new Error(`${status.date} 有 ${jobs.length} 个候选任务，为避免误发已停止：${jobs.map((job) => job.id).join('、')}`);
  }
  return api('/daily/publish', {
    method: 'POST',
    body: JSON.stringify({ jobId: jobs[0].id, platform }),
  });
}

async function status() {
  const daily = await api<DailyStatus>('/daily/status');
  const manifests = await approvedManifests();
  const state = await api<PublishingState>('/state');
  const usedManifests = new Set(state.jobs
    .map((job) => job.source?.manifestPath)
    .filter((manifestPath): manifestPath is string => Boolean(manifestPath))
    .map((manifestPath) => path.resolve(manifestPath)));
  const approvedQueue = manifests.map((manifestPath) => ({
    manifestPath: path.relative(projectRoot, manifestPath),
    used: usedManifests.has(path.resolve(manifestPath)),
  }));
  return {
    timezone: 'Asia/Shanghai',
    days: weeklyPublishingDays,
    slots: weeklyPublishingSlots,
    approvedQueue,
    availableApproved: approvedQueue.filter((item) => !item.used).length,
    today: daily,
  };
}

function usage() {
  console.log(`
洗哩洗哩每周自动运营 CLI

  xilixili-weekly status
  xilixili-weekly prepare
  xilixili-weekly publish <douyin|xiaohongshu|kuaishou|wechat_channels>

只处理 content/approved/ 中 approvedForAutoPublish=true 的内容。
`);
}

async function main() {
  const [, , command, platformValue] = process.argv;
  let result: unknown;
  if (!command || command === 'help') return usage();
  if (command === 'status') result = await status();
  else if (command === 'prepare') result = await prepare();
  else if (command === 'publish') {
    const platform = platformValue as PlatformId;
    if (!platformIds.includes(platform)) throw new Error('请提供有效平台编号');
    result = await publish(platform);
  } else throw new Error(`未知命令：${command}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
