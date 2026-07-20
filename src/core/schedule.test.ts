import { describe, expect, it } from 'vitest';
import { createPublicationPlan, getDailySchedule, shanghaiDate } from './schedule.js';

describe('目标客户发布时间建议', () => {
  it('工作日先发视频号，晚间依次错峰', () => {
    const schedule = getDailySchedule('2026-07-20');

    expect(schedule.dayType).toBe('weekday');
    expect(schedule.recommendations.wechat_channels.localTime).toBe('12:10');
    expect(schedule.recommendations.kuaishou.localTime).toBe('20:05');
    expect(schedule.recommendations.douyin.localTime).toBe('20:35');
    expect(schedule.recommendations.xiaohongshu.localTime).toBe('21:05');
  });

  it('周末把视频号后移到晚间', () => {
    const schedule = getDailySchedule('2026-07-19');

    expect(schedule.dayType).toBe('weekend');
    expect(schedule.recommendations.wechat_channels.localTime).toBe('19:35');
  });

  it('只给任务选中的平台建立排期', () => {
    const plan = createPublicationPlan('2026-07-20', ['douyin', 'xiaohongshu']);

    expect(Object.keys(plan)).toEqual(['douyin', 'xiaohongshu']);
    expect(plan.douyin?.scheduledAt).toBe('2026-07-20T20:35:00+08:00');
  });

  it('拒绝不存在的日期', () => {
    expect(() => getDailySchedule('2026-02-30')).toThrow('无效的排期日期');
  });

  it('按上海时区生成当天日期', () => {
    expect(shanghaiDate(new Date('2026-07-18T16:30:00Z'))).toBe('2026-07-19');
  });
});
