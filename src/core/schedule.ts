import { platformIds, type PlatformId, type PublicationPlan } from './types.js';

export const publishingTimezone = 'Asia/Shanghai';
export const targetAudience = '江西酒店业主、店总、筹建采购、工程与运营负责人';

export interface TimingRecommendation {
  platform: PlatformId;
  scheduledAt: string;
  localTime: string;
  window: string;
  rationale: string;
}

export interface DailySchedule {
  date: string;
  dayType: 'weekday' | 'weekend';
  timezone: typeof publishingTimezone;
  audience: typeof targetAudience;
  strategy: string;
  recommendations: Record<PlatformId, TimingRecommendation>;
}

type TimingRule = Omit<TimingRecommendation, 'platform' | 'scheduledAt'>;

const weekdayRules: Record<PlatformId, TimingRule> = {
  wechat_channels: {
    localTime: '12:10',
    window: '11:50–12:40',
    rationale: '午间先触达微信工作关系链，适合店总和采购在工作间隙阅读、转发。',
  },
  kuaishou: {
    localTime: '20:05',
    window: '20:00–22:00',
    rationale: '进入快手晚间活跃窗口后先发，给首轮互动和推荐分发留出时间。',
  },
  douyin: {
    localTime: '20:35',
    window: '20:00–22:00',
    rationale: '避开酒店下午入住高峰，在客户晚间短视频消费时段承接案例与改造内容。',
  },
  xiaohongshu: {
    localTime: '21:05',
    window: '20:00–22:00',
    rationale: '落在小红书公开报告的晚间搜索高峰，适合选型清单、避坑和参数型内容。',
  },
};

const weekendRules: Record<PlatformId, TimingRule> = {
  wechat_channels: {
    localTime: '19:35',
    window: '19:15–20:15',
    rationale: '周末酒店白天接待更忙，视频号后移到晚间，以熟人转发和行业关系链为主。',
  },
  kuaishou: {
    localTime: '20:05',
    window: '20:00–22:00',
    rationale: '保持在快手晚间活跃窗口，优先发布现场安装、前后对比等直观内容。',
  },
  douyin: {
    localTime: '20:35',
    window: '20:00–22:00',
    rationale: '酒店入住高峰基本结束后发布，更容易获得业主和运营人员的完整观看。',
  },
  xiaohongshu: {
    localTime: '21:05',
    window: '20:00–22:00',
    rationale: '用晚间搜索高峰承接主动检索，重点覆盖酒店投影选型与影音房改造需求。',
  },
};

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('排期日期必须使用 YYYY-MM-DD 格式');
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || parsed.toLocaleDateString('en-CA', { timeZone: publishingTimezone }) !== date) {
    throw new Error(`无效的排期日期：${date}`);
  }
}

export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: publishingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function getDailySchedule(date = shanghaiDate()): DailySchedule {
  validateDate(date);
  const day = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  const dayType = day === 0 || day === 6 ? 'weekend' : 'weekday';
  const rules = dayType === 'weekend' ? weekendRules : weekdayRules;

  const recommendations = Object.fromEntries(platformIds.map((platform) => {
    const rule = rules[platform];
    return [platform, {
      platform,
      ...rule,
      scheduledAt: `${date}T${rule.localTime}:00+08:00`,
    }];
  })) as DailySchedule['recommendations'];

  return {
    date,
    dayType,
    timezone: publishingTimezone,
    audience: targetAudience,
    strategy: dayType === 'weekend'
      ? '周末避开酒店白天接待高峰，集中在晚间按平台错峰。'
      : '工作日先用视频号覆盖午间工作关系链，晚间再按快手、抖音、小红书错峰。',
    recommendations,
  };
}

export function createPublicationPlan(date: string, targets: PlatformId[]): PublicationPlan {
  const recommendations = getDailySchedule(date).recommendations;
  return Object.fromEntries(targets.map((platform) => {
    const { scheduledAt, window, rationale } = recommendations[platform];
    return [platform, { scheduledAt, window, rationale }];
  })) as PublicationPlan;
}
