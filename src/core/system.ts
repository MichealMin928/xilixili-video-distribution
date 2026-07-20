import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromeExecutable } from '../browser/manager.js';
import { chromeProfileDir, projectRoot, stateFile, webDistDir } from './paths.js';
import type { Store } from './store.js';

export type SystemCheckStatus = 'ready' | 'warning' | 'error';

export interface SystemCheck {
  id: string;
  label: string;
  status: SystemCheckStatus;
  detail: string;
  action?: string;
}

export interface SystemDiagnosis {
  status: 'ready' | 'needs_setup' | 'error';
  checkedAt: string;
  projectRoot: string;
  checks: SystemCheck[];
  nextActions: string[];
}

async function accessible(target: string, mode = 0): Promise<boolean> {
  return fs.access(target, mode).then(() => true).catch(() => false);
}

export async function diagnoseSystem(store: Store): Promise<SystemDiagnosis> {
  const state = await store.read();
  const checks: SystemCheck[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node',
    label: 'Node.js',
    status: nodeMajor >= 20 ? 'ready' : 'error',
    detail: `${process.versions.node} (${process.execPath})`,
    action: nodeMajor >= 20 ? undefined : '安装 Node.js 20 或更高版本。',
  });

  const chromeReady = await accessible(chromeExecutable, fs.constants.X_OK);
  checks.push({
    id: 'chrome',
    label: 'Google Chrome',
    status: chromeReady ? 'ready' : 'error',
    detail: chromeExecutable,
    action: chromeReady ? undefined : '安装 Google Chrome，或设置 XILIXILI_CHROME_PATH。',
  });

  const stateReady = await accessible(path.dirname(stateFile), fs.constants.W_OK);
  checks.push({
    id: 'state',
    label: '本机状态',
    status: stateReady ? 'ready' : 'error',
    detail: stateFile,
    action: stateReady ? undefined : '检查 .local 目录的写入权限。',
  });

  const profileReady = await accessible(chromeProfileDir, fs.constants.R_OK | fs.constants.W_OK);
  checks.push({
    id: 'chrome-profile',
    label: '专用 Chrome 资料',
    status: profileReady ? 'ready' : 'warning',
    detail: profileReady ? chromeProfileDir : '首次打开登录页时自动创建。',
  });

  const webReady = await accessible(path.join(webDistDir, 'index.html'), fs.constants.R_OK);
  checks.push({
    id: 'build',
    label: '生产构建',
    status: webReady ? 'ready' : 'warning',
    detail: webReady ? webDistDir : '还没有可供系统服务使用的 Web 构建。',
    action: webReady ? undefined : '运行 npm run build。',
  });

  const activeJobs = state.jobs.filter((job) => job.status !== 'published');
  const missingMedia = new Set<string>();
  for (const job of activeJobs) {
    for (const mediaPath of job.mediaPaths) {
      if (!await accessible(mediaPath, fs.constants.R_OK)) missingMedia.add(mediaPath);
    }
  }
  checks.push({
    id: 'media',
    label: '待办素材',
    status: missingMedia.size ? 'warning' : 'ready',
    detail: missingMedia.size ? `${missingMedia.size} 个待办素材文件不可用。` : '待办任务的素材路径可用。',
    action: missingMedia.size ? '打开任务检查素材，必要时重新创建任务。' : undefined,
  });

  const loggedIn = Object.values(state.accounts).filter((account) => account.status === 'logged_in').length;
  checks.push({
    id: 'accounts',
    label: '平台账号',
    status: loggedIn === 4 ? 'ready' : 'warning',
    detail: `${loggedIn}/4 个平台已确认登录。`,
    action: loggedIn === 4 ? undefined : '运行 xilixili setup，完成扫码/短信验证后再运行 xilixili check all。',
  });

  const launchAgent = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.xilixili.publisher.plist');
  const serviceInstalled = await accessible(launchAgent, fs.constants.R_OK);
  checks.push({
    id: 'system-service',
    label: 'macOS 系统服务',
    status: serviceInstalled ? 'ready' : 'warning',
    detail: serviceInstalled ? launchAgent : '尚未安装登录自启服务。',
    action: serviceInstalled ? undefined : '运行 npm run system:install。',
  });

  const cliPath = path.join(os.homedir(), '.local', 'bin', 'xilixili');
  const cliInstalled = await accessible(cliPath, fs.constants.X_OK);
  checks.push({
    id: 'cli',
    label: '系统命令',
    status: cliInstalled ? 'ready' : 'warning',
    detail: cliInstalled ? cliPath : '尚未安装 xilixili 命令。',
    action: cliInstalled ? undefined : '运行 npm run system:install。',
  });

  const skillPath = path.join(os.homedir(), '.codex', 'skills', 'xilixili-daily-ops', 'SKILL.md');
  const skillInstalled = await accessible(skillPath, fs.constants.R_OK);
  checks.push({
    id: 'codex-skill',
    label: 'Codex 技能',
    status: skillInstalled ? 'ready' : 'warning',
    detail: skillInstalled ? skillPath : '尚未安装 xilixili-daily-ops 技能。',
    action: skillInstalled ? undefined : '运行 npm run system:install。',
  });

  const nextActions = checks.flatMap((check) => check.action ? [check.action] : []);
  const status = checks.some((check) => check.status === 'error')
    ? 'error'
    : checks.some((check) => check.status === 'warning')
      ? 'needs_setup'
      : 'ready';

  return {
    status,
    checkedAt: new Date().toISOString(),
    projectRoot,
    checks,
    nextActions: [...new Set(nextActions)],
  };
}
