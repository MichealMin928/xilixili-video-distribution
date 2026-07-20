import { describe, expect, it } from 'vitest';
import { assertPublicFacingCopy, assertWatermarkFreeVideo } from './content-policy.js';

describe('公开内容发布门槛', () => {
  it('阻止未确认无水印的视频进入平台流程', () => {
    expect(() => assertWatermarkFreeVideo('video', false)).toThrow('视频尚未确认无水印');
    expect(() => assertWatermarkFreeVideo('video')).toThrow('视频尚未确认无水印');
    expect(() => assertWatermarkFreeVideo('video', true)).not.toThrow();
    expect(() => assertWatermarkFreeVideo('gallery', false)).not.toThrow();
  });

  it('阻止对外文案出现内部镜头说明句', () => {
    expect(() => assertPublicFacingCopy({
      title: '酒店投影怎么选',
      body: '这条视频展示酒店投影安装后的真实效果。',
    })).toThrow('内部镜头说明');
    expect(() => assertPublicFacingCopy({
      title: '酒店投影怎么选',
      body: '本视频介绍酒店投影的选择方法。',
    })).toThrow('内部镜头说明');
    expect(() => assertPublicFacingCopy({
      title: '酒店投影怎么选',
      body: '先看投射距离、亮度和后期维护，再决定型号。',
    })).not.toThrow();
  });
});
