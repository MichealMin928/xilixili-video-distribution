export const platformOrder = ['douyin', 'xiaohongshu', 'kuaishou', 'wechat_channels'] as const;

export type PlatformId = (typeof platformOrder)[number];

export const platformNames: Record<PlatformId, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  wechat_channels: '视频号',
};
