import { platformIds, type PlatformId } from '../core/types.js';

const baseUrl = process.env.XILIXILI_API_URL ?? 'http://127.0.0.1:4317/api';

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

function parseTargets(value?: string): PlatformId[] | undefined {
  if (!value || value === 'all') return undefined;
  const targets = value.split(',') as PlatformId[];
  for (const target of targets) {
    if (!platformIds.includes(target)) throw new Error(`未知平台：${target}`);
  }
  return targets;
}

function usage() {
  console.log(`
洗哩洗哩互动巡检 CLI

  xilixili-engagement status
  xilixili-engagement scan [all|douyin,xiaohongshu,kuaishou,wechat_channels]

scan 只读取普通账号可见的评论和私信摘要，并从中识别潜在客户；不会自动回复、删除或导出联系人。
`);
}

async function main() {
  const [, , command, targetValue] = process.argv;
  if (!command || command === 'help') return usage();
  let result: unknown;
  if (command === 'status') result = await api('/engagement/status');
  else if (command === 'scan') {
    result = await api('/engagement/scan', {
      method: 'POST',
      body: JSON.stringify({ targets: parseTargets(targetValue) }),
    });
  } else throw new Error(`未知命令：${command}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
