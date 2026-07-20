import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  discoverContentAssets,
  loadContentAsset,
  resolveContentMediaFile,
  type ContentAsset,
} from '../core/content-library.js';
import { Orchestrator } from '../core/orchestrator.js';
import { platformIds, type PlatformId, type PlatformResult } from '../core/types.js';
import { localDir, projectRoot, webDistDir } from '../core/paths.js';
import { platformConfigs } from '../platforms/config.js';
import { getDailySchedule } from '../core/schedule.js';
import { DailyService } from '../core/daily-service.js';
import { diagnoseSystem } from '../core/system.js';
import { EngagementService } from '../core/engagement-service.js';

const host = '127.0.0.1';
const port = Number(process.env.XILIXILI_PORT ?? 4317);
const app = express();
const orchestrator = new Orchestrator();
const dailyService = new DailyService(orchestrator);
const engagementService = new EngagementService(orchestrator.browser, orchestrator.store);
const studioStateFile = path.join(localDir, 'content-studio.json');
let studioAssetIndex = new Map<string, ContentAsset>();
const studioPrepareInFlight = new Map<string, Promise<StudioRun>>();
const allowedLoopbackHosts = new Set(['127.0.0.1', 'localhost']);

interface StudioStage {
  id: 'validate' | 'package' | 'prepare' | 'publish';
  label: string;
  detail: string;
  status: 'complete' | 'active' | 'queued' | 'attention';
}

interface StudioRun {
  id: string;
  createdAt: string;
  assetId: string;
  title: string;
  kind: 'video' | 'gallery';
  targets: PlatformId[];
  watermarkFreeConfirmed: boolean;
  status: 'ready' | 'preparing' | 'prepared' | 'needs_attention';
  jobId?: string;
  results?: PlatformResult[];
  stages: StudioStage[];
}

interface StudioState {
  runs: StudioRun[];
}

async function refreshStudioAssetIndex(): Promise<ContentAsset[]> {
  const assets = await discoverContentAssets(projectRoot);
  studioAssetIndex = new Map(assets.map((asset) => [asset.id, asset]));
  return assets;
}

async function getStudioAsset(id: string): Promise<ContentAsset | undefined> {
  let cached = studioAssetIndex.get(id);
  if (!cached) {
    await refreshStudioAssetIndex();
    cached = studioAssetIndex.get(id);
  }
  if (!cached) return undefined;

  const current = await loadContentAsset(projectRoot, cached.manifestPath);
  if (!current || current.id !== id) {
    studioAssetIndex.delete(id);
    return undefined;
  }
  studioAssetIndex.set(id, current);
  return current;
}

function markStudioPreparing(stages: StudioStage[]): StudioStage[] {
  return stages.map((stage) => {
    if (stage.id === 'package') return { ...stage, status: 'complete' };
    if (stage.id === 'prepare') return { ...stage, status: 'active' };
    return stage;
  });
}

function completeStudioPrepare(stages: StudioStage[], succeeded: number, total: number): StudioStage[] {
  const complete = succeeded === total;
  return stages.map((stage) => {
    if (stage.id === 'prepare') {
      return {
        ...stage,
        status: complete ? 'complete' : 'attention',
        detail: `已完成 ${succeeded}/${total} 个平台预填`,
      };
    }
    if (stage.id === 'publish') {
      return {
        ...stage,
        status: complete ? 'active' : 'queued',
        detail: complete ? '请到发布管理输入任务编号后逐平台确认' : '先处理未成功平台，再进入人工发布',
      };
    }
    return stage;
  });
}

function readStudioState(): StudioState {
  try {
    const state = JSON.parse(fs.readFileSync(studioStateFile, 'utf8')) as Partial<StudioState>;
    return { runs: state.runs ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { runs: [] };
  }
}

function writeStudioState(state: StudioState): void {
  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(studioStateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function updateStudioRun(id: string, update: (run: StudioRun) => void): StudioRun | undefined {
  const state = readStudioState();
  const run = state.runs.find((item) => item.id === id);
  if (!run) return undefined;
  update(run);
  writeStudioState(state);
  return run;
}

async function performStudioPrepare(id: string): Promise<StudioRun> {
  const initialRun = readStudioState().runs.find((item) => item.id === id);
  if (!initialRun) throw new Error('未找到这次内容工作台任务');
  const asset = await getStudioAsset(initialRun.assetId);
  if (!asset) throw new Error('所选内容已失效，请重新选择');

  updateStudioRun(id, (run) => {
    run.status = 'preparing';
    run.stages = markStudioPreparing(run.stages);
  });

  let jobId = initialRun.jobId;
  if (!jobId) {
    const job = await orchestrator.createJob({
      kind: asset.kind,
      watermarkFreeConfirmed: initialRun.watermarkFreeConfirmed,
      mediaPaths: asset.mediaFiles,
      title: asset.title,
      body: asset.body,
      hashtags: asset.hashtags,
      targets: initialRun.targets,
      sourceManifest: asset.manifestPath,
      createdBy: 'web',
    });
    jobId = job.id;
    updateStudioRun(id, (run) => { run.jobId = job.id; });
  }

  await orchestrator.prepare(jobId, initialRun.targets);
  const updatedJob = await orchestrator.store.getJob(jobId);
  const prepared = new Set(updatedJob.results
    .filter((result) => result.phase === 'prepare' && result.status === 'success')
    .map((result) => result.platform));
  const succeeded = initialRun.targets.filter((platform) => prepared.has(platform)).length;
  const currentResults = updatedJob.results.filter((result) => (
    result.phase === 'prepare' && initialRun.targets.includes(result.platform)
  ));
  return updateStudioRun(id, (run) => {
    run.jobId = jobId;
    run.results = currentResults;
    run.status = succeeded === run.targets.length ? 'prepared' : 'needs_attention';
    run.stages = completeStudioPrepare(run.stages, succeeded, run.targets.length);
  })!;
}

async function markStudioPrepareFailed(id: string): Promise<void> {
  const run = readStudioState().runs.find((item) => item.id === id);
  if (!run) return;
  let succeeded = 0;
  if (run.jobId) {
    const job = await orchestrator.store.getJob(run.jobId).catch(() => undefined);
    if (job) {
      const prepared = new Set(job.results
        .filter((result) => result.phase === 'prepare' && result.status === 'success')
        .map((result) => result.platform));
      succeeded = run.targets.filter((platform) => prepared.has(platform)).length;
    }
  }
  updateStudioRun(id, (current) => {
    current.status = 'needs_attention';
    current.stages = completeStudioPrepare(current.stages, succeeded, current.targets.length);
  });
}

async function prepareStudioRun(id: string): Promise<StudioRun> {
  const current = studioPrepareInFlight.get(id);
  if (current) return current;

  const pending = performStudioPrepare(id).catch(async (error) => {
    await markStudioPrepareFailed(id);
    throw error;
  }).finally(() => {
    if (studioPrepareInFlight.get(id) === pending) studioPrepareInFlight.delete(id);
  });
  studioPrepareInFlight.set(id, pending);
  return pending;
}

app.disable('x-powered-by');
app.use((request, response, next) => {
  if (!allowedLoopbackHosts.has(request.hostname)) {
    return response.status(403).json({ error: '只接受来自本机地址的请求' });
  }
  const origin = request.get('origin');
  if (origin) {
    try {
      if (!allowedLoopbackHosts.has(new URL(origin).hostname)) {
        return response.status(403).json({ error: '只接受来自本机页面的请求' });
      }
    } catch {
      return response.status(403).json({ error: '请求来源无效' });
    }
  }
  return next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: '洗哩洗哩视频分发', version: '0.3.0', now: new Date().toISOString() });
});

app.get('/api/studio', async (_request, response) => {
  const assets = await refreshStudioAssetIndex();
  const state = readStudioState();
  response.json({
    generatedAt: new Date().toISOString(),
    assets: assets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      kind: asset.kind,
      source: asset.source,
      theme: asset.theme,
      mediaCount: asset.mediaFiles.length,
      modifiedAt: asset.modifiedAt,
      watermarkFreeConfirmed: asset.watermarkFreeConfirmed,
      targets: asset.targets,
      previewUrl: `/api/studio/assets/${asset.id}/media`,
    })),
    latestRun: state.runs[0],
  });
});

app.get('/api/studio/assets/:id/media', async (request, response) => {
  const asset = await getStudioAsset(request.params.id);
  if (!asset) return response.status(404).json({ error: '未找到预览素材' });
  const mediaFile = await resolveContentMediaFile(projectRoot, asset.mediaFiles[0]!);
  if (!mediaFile) return response.status(404).json({ error: '预览素材已失效' });
  response.setHeader('cache-control', 'private, max-age=300');
  return response.sendFile(mediaFile);
});

app.post('/api/studio/runs', async (request, response) => {
  const body = z.object({
    assetId: z.string().min(1),
    targets: z.array(z.enum(platformIds)).min(1),
    watermarkFreeConfirmed: z.boolean().default(false),
  }).parse(request.body ?? {});
  const asset = await getStudioAsset(body.assetId);
  if (!asset) throw new Error('所选内容已失效，请刷新内容池');
  if (asset.kind === 'video' && !asset.watermarkFreeConfirmed && !body.watermarkFreeConfirmed) {
    throw new Error('视频尚未确认无水印，不能进入平台预填');
  }

  const run: StudioRun = {
    id: `studio-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6)}`,
    createdAt: new Date().toISOString(),
    assetId: asset.id,
    title: asset.title,
    kind: asset.kind,
    targets: body.targets,
    watermarkFreeConfirmed: asset.kind === 'gallery' || asset.watermarkFreeConfirmed || body.watermarkFreeConfirmed,
    status: 'ready',
    stages: [
      { id: 'validate', label: '核验内容', detail: '素材路径、公开文案和发布门槛已通过', status: 'complete' },
      { id: 'package', label: '平台适配', detail: '将按各平台标题、正文和原生话题规则处理', status: 'queued' },
      { id: 'prepare', label: '平台预填', detail: '等待明确执行后打开所选平台并预填', status: 'queued' },
      { id: 'publish', label: '人工发布', detail: '预填完成后仍需任务编号二次确认', status: 'queued' },
    ],
  };
  const state = readStudioState();
  state.runs.unshift(run);
  state.runs = state.runs.slice(0, 30);
  writeStudioState(state);
  await orchestrator.store.addAudit({
    action: 'studio.run.created',
    subject: run.id,
    detail: `内容工作台已选择“${asset.title}”，目标：${body.targets.map((id) => platformConfigs[id].shortName).join('、')}`,
    outcome: 'success',
  });
  response.status(201).json(run);
});

app.post('/api/studio/runs/:id/prepare', async (request, response) => {
  const body = z.object({ confirmation: z.string().min(1) }).parse(request.body ?? {});
  if (body.confirmation !== request.params.id) throw new Error('预填确认文字必须等于本次工作台任务编号');

  const existing = readStudioState().runs.some((item) => item.id === request.params.id);
  if (!existing) return response.status(404).json({ error: '未找到这次内容工作台任务' });
  return response.json(await prepareStudioRun(request.params.id));
});

app.get('/api/system/doctor', async (_request, response) => {
  response.json(await diagnoseSystem(orchestrator.store));
});

app.get('/api/state', async (_request, response) => {
  response.json(await orchestrator.store.read());
});

app.get('/api/schedule', (request, response) => {
  const query = z.object({ date: z.string().optional() }).parse(request.query);
  response.json(getDailySchedule(query.date));
});

app.get('/api/daily/status', async (_request, response) => {
  response.json(await dailyService.status());
});

app.get('/api/engagement/status', async (_request, response) => {
  response.json(await engagementService.status());
});

app.post('/api/engagement/scan', async (request, response) => {
  const body = z.object({
    targets: z.array(z.enum(platformIds)).optional(),
  }).parse(request.body ?? {});
  response.json(await engagementService.scan(body.targets));
});

app.post('/api/daily/plan', async (request, response) => {
  const body = z.object({
    manifestPath: z.string().optional(),
    force: z.boolean().default(false),
  }).parse(request.body ?? {});
  response.json(await dailyService.plan(body.manifestPath, body.force));
});

app.post('/api/daily/start', async (request, response) => {
  const body = z.object({
    manifestPath: z.string().optional(),
    force: z.boolean().default(false),
  }).parse(request.body ?? {});
  response.json(await dailyService.start(body.manifestPath, body.force));
});

app.post('/api/daily/publish', async (request, response) => {
  const body = z.object({
    jobId: z.string().min(1),
    platform: z.enum(platformIds),
  }).parse(request.body ?? {});
  response.json(await dailyService.publish(body.jobId, body.platform));
});

app.get('/api/platforms', (_request, response) => {
  response.json(platformIds.map((id) => ({
    id,
    name: platformConfigs[id].name,
    shortName: platformConfigs[id].shortName,
  })));
});

app.post('/api/platforms/:platform/login', async (request, response) => {
  const platform = z.enum(platformIds).parse(request.params.platform);
  response.json(await orchestrator.openLogin(platform));
});

app.post('/api/platforms/:platform/check', async (request, response) => {
  const platform = z.enum(platformIds).parse(request.params.platform);
  response.json(await orchestrator.checkLogin(platform));
});

app.get('/api/platforms/:platform/diagnostics', async (request, response) => {
  const platform = z.enum(platformIds).parse(request.params.platform);
  response.json(await orchestrator.adapters[platform].diagnostics());
});

app.post('/api/platforms/:platform/native-schedule/open', async (request, response) => {
  const platform = z.enum(platformIds).parse(request.params.platform);
  response.json(await orchestrator.adapters[platform].openNativeSchedulePicker());
});

app.post('/api/jobs', async (request, response) => {
  response.status(201).json(await orchestrator.createJob(request.body));
});

app.post('/api/jobs/:id/prepare', async (request, response) => {
  const body = z.object({ targets: z.array(z.enum(platformIds)).optional() }).parse(request.body ?? {});
  response.json(await orchestrator.prepare(request.params.id, body.targets));
});

app.post('/api/jobs/:id/publish', async (request, response) => {
  const body = z.object({
    confirmation: z.string(),
    targets: z.array(z.enum(platformIds)).optional(),
    convertScheduledToImmediate: z.boolean().default(false),
  }).parse(request.body ?? {});
  response.json(await orchestrator.publish(request.params.id, body.confirmation, body.targets, {
    convertScheduledToImmediate: body.convertScheduledToImmediate,
  }));
});

app.post('/api/jobs/:id/native-schedule', async (request, response) => {
  const body = z.object({
    confirmation: z.string(),
    platform: z.enum(platformIds),
  }).parse(request.body ?? {});
  response.json(await orchestrator.scheduleNative(request.params.id, body.confirmation, body.platform));
});

if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.use((_request, response) => response.sendFile(`${webDistDir}/index.html`));
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  response.status(400).json({ error: message });
});

const server = app.listen(port, host, () => {
  console.log(`洗哩洗哩视频分发：http://${host}:${port}`);
});

const shutdown = async () => {
  server.close();
  await orchestrator.browser.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
