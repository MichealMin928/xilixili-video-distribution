import { describe, expect, it } from 'vitest';
import {
  buildDeckHtml,
  createDraftManifest,
  parseContentSpec,
  type ContentSpec,
} from './content-renderer.js';

const page = (number: number) => ({
  number,
  layout: number === 1 ? 'cover' as const : 'check' as const,
  kicker: `第 ${number} 页`,
  title: `检查项目 ${number}`,
  judgment: `核心判断 ${number}`,
  points: [`要点 ${number}-1`, `要点 ${number}-2`],
  scopeLimit: '具体方法以设备、投射方式、网络架构和现场条件为准。',
});

const validSpec: ContentSpec = {
  id: 'XLL-2026-003',
  title: '开业前 7 天，酒店投影要验收这 6 项',
  audience: '江西酒店负责人',
  evidenceSources: ['content/example/事实与验收依据.md'],
  claimBoundary: '不承诺固定亮度、画面尺寸、零故障或收益。',
  action: '领取可打印验收表',
  pages: Array.from({ length: 7 }, (_, index) => page(index + 1)),
};

describe('content renderer contract', () => {
  it('accepts a complete seven-page evidence-backed spec', () => {
    expect(parseContentSpec(validSpec)).toEqual(validSpec);
  });

  it('rejects a deck that is not exactly seven pages', () => {
    expect(() => parseContentSpec({ ...validSpec, pages: validSpec.pages.slice(0, 6) }))
      .toThrow(/7/);
  });

  it('renders all seven numbered cards and escapes source text', () => {
    const html = buildDeckHtml({
      ...validSpec,
      pages: validSpec.pages.map((item, index) => index === 1
        ? { ...item, title: '<script>alert(1)</script>' }
        : item),
    });

    expect(html.match(/data-page="/g)).toHaveLength(7);
    expect(html).toContain('width:1080px');
    expect(html).toContain('height:1440px');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('creates portable unapproved gallery and video manifests', () => {
    const gallery = createDraftManifest(validSpec, 'gallery', [
      'content/example/generated/01.png',
      'content/example/generated/02.png',
    ]);
    const video = createDraftManifest(validSpec, 'video', [
      'content/example/generated/video.mp4',
    ]);

    expect(gallery.kind).toBe('gallery');
    expect(video.kind).toBe('video');
    expect(gallery.approvedForAutoPublish).toBe(false);
    expect(video.approvedForAutoPublish).toBe(false);
    expect(gallery.targets).toEqual(['douyin', 'xiaohongshu', 'kuaishou', 'wechat_channels']);
  });
});
