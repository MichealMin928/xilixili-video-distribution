import { describe, expect, it } from 'vitest';
import {
  classifyEngagement,
  engagementFingerprint,
  isEngagementNoise,
  parsePlatformDate,
} from './engagement.js';

describe('engagement classification', () => {
  it('marks concrete hotel procurement questions as high priority', () => {
    const result = classifyEngagement('我们南昌新开一家30间房的酒店，想了解投影安装报价');
    expect(result.priority).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(7);
    expect(result.reasons).toContain('询价/预算');
    expect(result.reasons).toContain('目标门店');
  });

  it('keeps vague cooperation questions for manual follow-up', () => {
    const result = classifyEngagement('想了解怎么加盟');
    expect(result.priority).toBe('high');
    expect(result.reasons).toContain('采购/合作');
  });

  it('deprioritizes follower-exchange spam', () => {
    const result = classifyEngagement('互关互粉，快速涨粉');
    expect(result.priority).toBe('low');
  });
});

describe('engagement identity', () => {
  it('is stable across repeated scans', () => {
    const source = {
      platform: 'kuaishou' as const,
      kind: 'comment' as const,
      author: '客户A',
      content: '想了解怎么加盟',
      occurredAt: '2026-01-08T02:58:00.000Z',
      pageUrl: 'https://cp.kuaishou.com/profile',
    };
    expect(engagementFingerprint(source)).toBe(engagementFingerprint({
      ...source,
      pageUrl: 'https://cp.kuaishou.com/article/comment',
    }));
  });

  it('rejects a Douyin dashboard summary masquerading as a comment', () => {
    expect(isEngagementNoise({
      platform: 'douyin',
      kind: 'comment',
      content: '最新作品 酒店投影怎么选 播放量 6 查看分析 数据总览',
    })).toBe(true);
  });
});

describe('platform dates', () => {
  it('uses the previous year when a month-day would otherwise be in the future', () => {
    expect(parsePlatformDate('12.31 23:10', new Date('2026-01-02T12:00:00Z'))
      ?.startsWith('2025-12-31')).toBe(true);
  });
});
