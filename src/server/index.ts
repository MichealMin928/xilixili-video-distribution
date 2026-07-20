import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { Orchestrator } from '../core/orchestrator.js';
import { platformIds } from '../core/types.js';
import { webDistDir } from '../core/paths.js';
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

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: '洗哩洗哩四平台运营台', version: '0.2.0', now: new Date().toISOString() });
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
  }).parse(request.body ?? {});
  response.json(await orchestrator.publish(request.params.id, body.confirmation, body.targets));
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
  console.log(`洗哩洗哩四平台运营台：http://${host}:${port}`);
});

const shutdown = async () => {
  server.close();
  await orchestrator.browser.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
