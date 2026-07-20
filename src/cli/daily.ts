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

function usage() {
  console.log(`
洗哩洗哩每日运营 CLI（手工启动，不创建后台定时任务）

  xilixili-daily plan [content/.../manifest.json]
  xilixili-daily start [content/.../manifest.json] [--force]
  xilixili-daily status
  xilixili-daily publish <job-id> <platform>
  xilixili-daily schedule <job-id> <platform>

系统安装后会自动保持运营台服务开启；开发模式可运行 npm run dev。
start 会检查四平台登录、创建或复用当天任务并完成预填，停在发布按钮前。
publish 只立即发布指定平台，并阻止早于计划时间的误操作。
schedule 选中平台给出的当日有效默认时间，当场提交原生定时发布，无需在线等待。
`);
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === 'help') return usage();

  let result: unknown;
  if (command === 'status') {
    result = await api('/daily/status');
  } else if (command === 'plan' || command === 'start') {
    const force = args.includes('--force');
    const manifestPath = args.find((item) => !item.startsWith('--'));
    result = await api(`/daily/${command}`, {
      method: 'POST',
      body: JSON.stringify({ manifestPath, force }),
    });
  } else if (command === 'publish') {
    const [jobId, platformValue] = args;
    const platform = platformValue as PlatformId;
    if (!jobId || !platformIds.includes(platform)) throw new Error('请提供任务编号和有效平台编号');
    result = await api('/daily/publish', {
      method: 'POST',
      body: JSON.stringify({ jobId, platform }),
    });
  } else if (command === 'schedule') {
    const [jobId, platformValue] = args;
    const platform = platformValue as PlatformId;
    if (!jobId || !platformIds.includes(platform)) throw new Error('请提供任务编号和有效平台编号');
    result = await api(`/jobs/${jobId}/native-schedule`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: jobId, platform }),
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
