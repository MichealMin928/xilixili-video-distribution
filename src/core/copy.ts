import type { PlatformCopy, PlatformId } from './types.js';

const limits: Record<PlatformId, { title: number; body: number; hashtags: number }> = {
  douyin: { title: 30, body: 1000, hashtags: 5 },
  xiaohongshu: { title: 20, body: 1000, hashtags: 5 },
  kuaishou: { title: 30, body: 1000, hashtags: 4 },
  wechat_channels: { title: 30, body: 1000, hashtags: 3 },
};

const cleanTag = (tag: string) => tag.trim().replace(/^#+|#+$/g, '');

export function adaptCopy(base: PlatformCopy, platform: PlatformId): PlatformCopy {
  const limit = limits[platform];
  const hashtags = [...new Set(base.hashtags.map(cleanTag).filter(Boolean))].slice(0, limit.hashtags);

  return {
    title: base.title.trim().slice(0, limit.title),
    body: base.body.trim().slice(0, limit.body),
    hashtags,
  };
}

export function renderBody(copy: PlatformCopy, platform: PlatformId): string {
  // 小红书话题需要从平台原生候选中选择；普通文本 #话题# 不会形成可点击话题。
  if (!copy.hashtags.length || platform === 'xiaohongshu') return copy.body;
  const tags = copy.hashtags.map((tag) => `#${tag}`).join(' ');
  return `${copy.body}\n\n${tags}`.trim();
}
