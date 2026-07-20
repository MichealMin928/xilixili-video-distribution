import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverContentAssets } from './content-library.js';

const temporaryRoots: string[] = [];

async function temporaryProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xilixili-library-'));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, 'content'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('本地内容素材库', () => {
  it('从有效清单生成可预览、可执行的内容单元', async () => {
    const root = await temporaryProject();
    const unit = path.join(root, 'content', 'draft-001');
    await fs.mkdir(unit, { recursive: true });
    await fs.writeFile(path.join(unit, '01-cover.png'), 'preview');
    await fs.writeFile(path.join(unit, 'manifest.json'), JSON.stringify({
      kind: 'gallery',
      mediaPaths: ['content/draft-001/01-cover.png'],
      title: '酒店投影开业验收',
      body: '从真实光线、投屏和稳定性开始检查。',
      hashtags: ['酒店投影', '开业验收'],
      targets: ['douyin', 'xiaohongshu'],
    }));

    const [asset] = await discoverContentAssets(root);

    expect(asset).toMatchObject({
      title: '酒店投影开业验收',
      kind: 'gallery',
      source: 'draft-001',
      theme: '酒店投影',
      targets: ['douyin', 'xiaohongshu'],
    });
    expect(asset?.mediaFiles).toEqual([await fs.realpath(path.join(unit, '01-cover.png'))]);
    expect(asset?.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('忽略无效清单和素材缺失的内容单元', async () => {
    const root = await temporaryProject();
    const invalid = path.join(root, 'content', 'invalid');
    const missing = path.join(root, 'content', 'missing');
    const archive = path.join(root, 'content', 'draft-001', 'archive', 'old-version');
    await fs.mkdir(invalid, { recursive: true });
    await fs.mkdir(missing, { recursive: true });
    await fs.mkdir(archive, { recursive: true });
    await fs.writeFile(path.join(invalid, 'manifest.json'), '{not json');
    await fs.writeFile(path.join(missing, 'manifest.json'), JSON.stringify({
      kind: 'video',
      watermarkFreeConfirmed: true,
      mediaPaths: ['content/missing/no-video.mp4'],
      title: '缺失视频',
      body: '正文',
      targets: ['douyin'],
    }));
    await fs.writeFile(path.join(archive, 'cover.png'), 'preview');
    await fs.writeFile(path.join(archive, 'manifest.json'), JSON.stringify({
      kind: 'gallery',
      mediaPaths: ['content/draft-001/archive/old-version/cover.png'],
      title: '历史归档',
      body: '不应出现在当前内容池',
      targets: ['douyin'],
    }));

    expect(await discoverContentAssets(root)).toEqual([]);
  });

  it('只允许 content 目录中的真实媒体文件用于预览', async () => {
    const root = await temporaryProject();
    const local = path.join(root, '.local');
    await fs.mkdir(local, { recursive: true });
    await fs.writeFile(path.join(local, 'state.json'), '{"secret":"cookie"}');
    await fs.writeFile(path.join(root, 'outside.png'), 'outside');

    const cases = [
      { name: 'state-file', media: '.local/state.json' },
      { name: 'unsupported', media: 'content/unsupported/notes.txt', create: 'notes.txt' },
      { name: 'symlink', media: 'content/symlink/cover.png', symlink: true },
    ];
    for (const item of cases) {
      const unit = path.join(root, 'content', item.name);
      await fs.mkdir(unit, { recursive: true });
      if (item.create) await fs.writeFile(path.join(unit, item.create), 'notes');
      if (item.symlink) await fs.symlink(path.join(root, 'outside.png'), path.join(unit, 'cover.png'));
      await fs.writeFile(path.join(unit, 'manifest.json'), JSON.stringify({
        kind: 'gallery',
        mediaPaths: [item.media],
        title: item.name,
        body: '公开正文',
        targets: ['douyin'],
      }));
    }

    expect(await discoverContentAssets(root)).toEqual([]);
  });

  it('不把含内部镜头说明的文案放入内容池', async () => {
    const root = await temporaryProject();
    const unit = path.join(root, 'content', 'meta-copy');
    await fs.mkdir(unit, { recursive: true });
    await fs.writeFile(path.join(unit, 'cover.png'), 'preview');
    await fs.writeFile(path.join(unit, 'manifest.json'), JSON.stringify({
      kind: 'gallery',
      mediaPaths: ['content/meta-copy/cover.png'],
      title: '内部文案',
      body: '这条视频展示酒店投影的安装过程。',
      targets: ['douyin'],
    }));

    expect(await discoverContentAssets(root)).toEqual([]);
  });
});
