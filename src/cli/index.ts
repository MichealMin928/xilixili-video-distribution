import fs from 'node:fs/promises';
import { platformIds, type PlatformId } from '../core/types.js';

const baseUrl = process.env.XILIXILI_API_URL ?? 'http://127.0.0.1:4317/api';

async function api(path: string, options?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...options?.headers },
    });
  } catch {
    throw new Error('运营台服务未运行。请先运行 xilixili-service start，或在项目中运行 npm run dev。');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function parsePlatforms(value?: string): PlatformId[] | undefined {
  if (!value || value === 'all') return undefined;
  const ids = value.split(',') as PlatformId[];
  for (const id of ids) {
    if (!platformIds.includes(id)) throw new Error(`未知平台：${id}`);
  }
  return ids;
}

function usage() {
  console.log(`
洗哩洗哩视频分发 CLI

  xilixili state
  xilixili doctor
  xilixili setup
  xilixili login <douyin|xiaohongshu|kuaishou|wechat_channels|all>
  xilixili check <platform|all>
  xilixili diagnose <platform>
  xilixili create <manifest.json>
  xilixili prepare <job-id> [platform,platform]
  xilixili publish <job-id> <confirmation> [platform,platform]
`);
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === 'help') return usage();

  let result: unknown;
  if (command === 'doctor') {
    result = await api('/system/doctor');
  } else if (command === 'setup') {
    const accounts = [];
    for (const platform of platformIds) {
      accounts.push(await api(`/platforms/${platform}/login`, { method: 'POST', body: '{}' }));
    }
    result = {
      message: '已在专用 Chrome 中打开四个平台。完成扫码、短信或安全验证后，运行 xilixili check all。',
      accounts,
    };
  } else if (command === 'state') {
    result = await api('/state');
  } else if (command === 'login' || command === 'check') {
    const platform = args[0];
    if (platform === 'all') {
      const accounts = [];
      for (const id of platformIds) {
        accounts.push(await api(`/platforms/${id}/${command}`, { method: 'POST', body: '{}' }));
      }
      result = accounts;
    } else {
      const id = platform as PlatformId;
      if (!platformIds.includes(id)) throw new Error('请提供有效平台编号或 all');
      result = await api(`/platforms/${id}/${command}`, { method: 'POST', body: '{}' });
    }
  } else if (command === 'diagnose') {
    const platform = args[0] as PlatformId;
    if (!platformIds.includes(platform)) throw new Error('请提供有效平台编号');
    result = await api(`/platforms/${platform}/diagnostics`);
  } else if (command === 'create') {
    if (!args[0]) throw new Error('请提供内容清单 JSON 文件');
    result = await api('/jobs', { method: 'POST', body: await fs.readFile(args[0], 'utf8') });
  } else if (command === 'prepare') {
    if (!args[0]) throw new Error('请提供任务编号');
    result = await api(`/jobs/${args[0]}/prepare`, {
      method: 'POST',
      body: JSON.stringify({ targets: parsePlatforms(args[1]) }),
    });
  } else if (command === 'publish') {
    if (!args[0] || !args[1]) throw new Error('请提供任务编号和相同的确认文字');
    result = await api(`/jobs/${args[0]}/publish`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: args[1], targets: parsePlatforms(args[2]) }),
    });
  } else {
    throw new Error(`未知命令：${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
