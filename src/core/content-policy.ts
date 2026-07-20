import type { ContentKind, PlatformCopy } from './types.js';

// These phrases describe the production process instead of speaking to the
// intended customer. Keep them in internal shot notes, never public copy.
export const forbiddenVideoMetaNarration = /(?:这条|本条|这个|本)?视频(?:中)?(?:展示|介绍|呈现|演示)/;

export function assertPublicFacingCopy(copy: Pick<PlatformCopy, 'title' | 'body'>): void {
  const matched = `${copy.title}\n${copy.body}`.match(forbiddenVideoMetaNarration)?.[0];
  if (matched) {
    throw new Error(`对外文案含内部镜头说明“${matched}”：请直接表达客户价值，不要写“这条/本视频展示……”`);
  }
}

export function assertWatermarkFreeVideo(
  kind: ContentKind,
  watermarkFreeConfirmed?: boolean,
): void {
  if (kind === 'video' && watermarkFreeConfirmed !== true) {
    throw new Error('视频尚未确认无水印：请使用无平台水印、无 AI 生成水印、无网址或二维码的源片，并在完整检查后确认');
  }
}
