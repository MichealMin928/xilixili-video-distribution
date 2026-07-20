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
  if (!copy.hashtags.length) return copy.body;
  const tags = platform === 'xiaohongshu'
    ? copy.hashtags.map((tag) => `#${tag}#`).join(' ')
    : copy.hashtags.map((tag) => `#${tag}`).join(' ');
  return `${copy.body}\n\n${tags}`.trim();
}
