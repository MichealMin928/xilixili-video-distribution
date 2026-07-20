import { createHash } from 'node:crypto';
import type {
  EngagementItem,
  EngagementKind,
  EngagementPriority,
  PlatformId,
} from './types.js';

export interface RawEngagementItem {
  platform: PlatformId;
  kind: EngagementKind;
  author?: string;
  content: string;
  occurredAt?: string;
  pageUrl: string;
}

const highIntentRules: Array<[RegExp, number, string]> = [
  [/(?:报价|多少钱|价格|预算|费用)/, 5, '询价/预算'],
  [/(?:采购|招标|供应商|合作|加盟|代理)/, 5, '采购/合作'],
  [/(?:开业|筹建|装修|翻新|改造|升级)/, 4, '项目节点'],
  [/(?:酒店|宾馆|民宿|公寓|客房|房间)/, 3, '目标门店'],
  [/(?:联系|电话|手机|微信|\b1[3-9]\d{9}\b)/, 5, '联系意愿'],
  [/(?:需要|想了解|怎么做|有方案吗|能不能)/, 2, '明确咨询'],
  [/(?:投影|幕布|投屏|安装|调试|投射距离)/, 2, '产品/落地需求'],
  [/(?:\d+\s*(?:间|台|套|个房|万|元))/, 4, '有规模/数量'],
];

const lowValueRules: Array<[RegExp, number, string]> = [
  [/(?:互关|互粉|涨粉|刷单|兼职|带货群|无货源)/, -8, '低价值推广'],
  [/^(?:赞|棒|不错|哈哈|收藏了|\[[^\]]+\])+[!！~。]*$/, -2, '纯互动'],
];

export function normalizeEngagementText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function classifyEngagement(content: string): {
  priority: EngagementPriority;
  score: number;
  reasons: string[];
  suggestedAction: string;
} {
  const text = normalizeEngagementText(content);
  let score = 0;
  const reasons: string[] = [];
  for (const [pattern, points, reason] of [...highIntentRules, ...lowValueRules]) {
    if (!pattern.test(text)) continue;
    score += points;
    reasons.push(reason);
  }
  const uniqueReasons = [...new Set(reasons)];
  const priority: EngagementPriority = score >= 7
    ? 'high'
    : score >= 4
      ? 'medium'
      : score < 0
        ? 'low'
        : 'normal';
  const suggestedAction = priority === 'high'
    ? '当天人工查看并回复，确认城市、门店类型、房间数、预算和开业/改造时间。'
    : priority === 'medium'
      ? '24小时内人工回复，先补齐项目场景和规模。'
      : priority === 'low'
        ? '无需优先跟进，人工确认后可忽略。'
        : '按普通互动处理，不要自动回复。';
  return { priority, score, reasons: uniqueReasons, suggestedAction };
}

export function engagementFingerprint(raw: RawEngagementItem): string {
  const stable = [
    raw.platform,
    raw.kind,
    normalizeEngagementText(raw.author ?? '').toLowerCase(),
    normalizeEngagementText(raw.content).toLowerCase(),
    raw.occurredAt ?? '',
  ].join('\n');
  return createHash('sha256').update(stable).digest('hex').slice(0, 24);
}

export function createEngagementItem(raw: RawEngagementItem, capturedAt: string): EngagementItem {
  const content = normalizeEngagementText(raw.content);
  const classification = classifyEngagement(content);
  return {
    id: engagementFingerprint({ ...raw, content }),
    platform: raw.platform,
    kind: raw.kind,
    author: raw.author ? normalizeEngagementText(raw.author) : undefined,
    content,
    occurredAt: raw.occurredAt,
    capturedAt,
    pageUrl: raw.pageUrl,
    ...classification,
  };
}

export function isEngagementNoise(item: Pick<EngagementItem, 'platform' | 'kind' | 'author' | 'content'>): boolean {
  return item.platform === 'douyin'
    && item.kind === 'comment'
    && !item.author
    && item.content.includes('最新作品')
    && /数据总览|查看分析/.test(item.content);
}

export function parsePlatformDate(value: string, now = new Date()): string | undefined {
  const match = value.trim().match(/^(\d{1,2})[.\/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const [, month, day, hour, minute] = match;
  let year = now.getFullYear();
  let date = new Date(year, Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (date.getTime() > now.getTime() + 86_400_000) {
    year -= 1;
    date = new Date(year, Number(month) - 1, Number(day), Number(hour), Number(minute));
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
