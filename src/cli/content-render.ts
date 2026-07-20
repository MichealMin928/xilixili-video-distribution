import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { chromeExecutable } from '../browser/manager.js';
import { projectRoot } from '../core/paths.js';
import {
  buildDeckHtml,
  buildOverviewHtml,
  createDraftManifest,
  parseContentSpec,
} from '../content/content-renderer.js';

const execFileAsync = promisify(execFile);

interface LayoutMeasurement {
  page: number;
  width: number;
  height: number;
  safeOverflowX: number;
  safeOverflowY: number;
  minTextSize: number;
  outOfBounds: string[];
}

interface QualityReport {
  contentId: string;
  checkedAt: string;
  passed: boolean;
  rules: {
    canvas: string;
    overflow: string;
    minimumText: string;
    approval: string;
  };
  pages: Array<LayoutMeasurement & { issues: string[] }>;
}

function resolveInput(value?: string): string {
  if (!value) {
    throw new Error('请提供内容规格文件，例如：npm run content:render -- content/draft-003-opening-acceptance/content-spec.json');
  }
  return path.resolve(projectRoot, value);
}

function projectRelative(target: string): string {
  return path.relative(projectRoot, target).split(path.sep).join('/');
}

function assess(measurement: LayoutMeasurement): string[] {
  const issues: string[] = [];
  if (measurement.width !== 1080 || measurement.height !== 1440) {
    issues.push(`画布应为 1080×1440，实际为 ${measurement.width}×${measurement.height}`);
  }
  if (measurement.safeOverflowX > 1 || measurement.safeOverflowY > 1) {
    issues.push(`安全区内容溢出 ${measurement.safeOverflowX}px × ${measurement.safeOverflowY}px`);
  }
  if (measurement.minTextSize < 16) {
    issues.push(`最小可见文字为 ${measurement.minTextSize}px，低于 16px`);
  }
  if (measurement.outOfBounds.length) {
    issues.push(`元素超出画布：${measurement.outOfBounds.join('、')}`);
  }
  return issues;
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function render(): Promise<void> {
  const specPath = resolveInput(process.argv[2]);
  const raw = JSON.parse(await fs.readFile(specPath, 'utf8')) as unknown;
  const spec = parseContentSpec(raw);
  const contentDir = path.dirname(specPath);
  const outputDir = path.join(contentDir, 'generated-poc');
  await fs.mkdir(outputDir, { recursive: true });

  const deckPath = path.join(outputDir, 'deck.html');
  await fs.writeFile(deckPath, buildDeckHtml(spec), 'utf8');

  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
  });

  const imagePaths: string[] = [];
  let measurements: LayoutMeasurement[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(deckPath).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const cards = page.locator('.card');
    const cardCount = await cards.count();
    if (cardCount !== 7) throw new Error(`应渲染 7 页，实际渲染 ${cardCount} 页。`);

    for (let index = 0; index < cardCount; index += 1) {
      const target = path.join(outputDir, `${String(index + 1).padStart(2, '0')}.png`);
      await cards.nth(index).screenshot({ path: target, animations: 'disabled' });
      imagePaths.push(target);
    }

    measurements = await page.locator('.card').evaluateAll((elements) => elements.map((element, index) => {
      const card = element as HTMLElement;
      const safe = card.querySelector<HTMLElement>('[data-safe]');
      const cardRect = card.getBoundingClientRect();
      const visibleText = [...card.querySelectorAll<HTMLElement>('h1,h2,h3,p,span,strong,small')]
        .filter((node) => node.innerText.trim() && getComputedStyle(node).display !== 'none');
      const minTextSize = visibleText.length
        ? Math.min(...visibleText.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)))
        : 0;
      const outOfBounds = [...card.querySelectorAll<HTMLElement>('[data-safe] > *, .card-body > *')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < cardRect.left - 1
            || rect.top < cardRect.top - 1
            || rect.right > cardRect.right + 1
            || rect.bottom > cardRect.bottom + 1;
        })
        .map((node) => node.className || node.tagName.toLowerCase());
      return {
        page: index + 1,
        width: Math.round(cardRect.width),
        height: Math.round(cardRect.height),
        safeOverflowX: safe ? Math.max(0, safe.scrollWidth - safe.clientWidth) : 999,
        safeOverflowY: safe ? Math.max(0, safe.scrollHeight - safe.clientHeight) : 999,
        minTextSize,
        outOfBounds,
      };
    }));

    const overviewPath = path.join(outputDir, 'overview.html');
    await fs.writeFile(overviewPath, buildOverviewHtml(spec, imagePaths), 'utf8');
    const overview = await browser.newPage({ viewport: { width: 2400, height: 2800 }, deviceScaleFactor: 1 });
    await overview.goto(pathToFileURL(overviewPath).href, { waitUntil: 'load' });
    await overview.evaluate(() => document.fonts.ready);
    await overview.screenshot({ path: path.join(outputDir, 'overview.png'), fullPage: true });
    await overview.close();
  } finally {
    await browser.close();
  }

  const report: QualityReport = {
    contentId: spec.id,
    checkedAt: new Date().toISOString(),
    passed: measurements.every((measurement) => assess(measurement).length === 0),
    rules: {
      canvas: '每页必须为 1080×1440。',
      overflow: '安全区和主要内容不得超出画布。',
      minimumText: '可见文字不得小于 16px。',
      approval: '所有生成清单必须保持 approvedForAutoPublish=false。',
    },
    pages: measurements.map((measurement) => ({ ...measurement, issues: assess(measurement) })),
  };
  await writeJson(path.join(outputDir, 'qa-report.json'), report);

  const videoPath = path.join(outputDir, `${spec.id}-vertical-proof.mp4`);
  const storyboard = {
    contentId: spec.id,
    format: { width: 1080, height: 1920, fps: 30 },
    durationSeconds: 24.5,
    slides: imagePaths.map((imagePath, index) => ({
      page: index + 1,
      image: projectRelative(imagePath),
      startSeconds: index * 3.5,
      durationSeconds: 3.5,
    })),
    audio: null,
    note: '本验证片仅使用已审核图文母版，无配音、音乐和外部素材。',
  };
  const storyboardPath = path.join(outputDir, 'video-storyboard.json');
  await writeJson(storyboardPath, storyboard);

  await execFileAsync('/usr/bin/swift', [
    path.join(projectRoot, 'scripts', 'render-card-video.swift'),
    videoPath,
    ...imagePaths,
  ], { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 });

  await writeJson(
    path.join(outputDir, 'manifest.gallery.json'),
    createDraftManifest(spec, 'gallery', imagePaths.map(projectRelative)),
  );
  await writeJson(
    path.join(outputDir, 'manifest.video.json'),
    createDraftManifest(spec, 'video', [projectRelative(videoPath)]),
  );

  const sources = [
    `# ${spec.id} 素材与证据来源`,
    '',
    '本验证样板未使用外部图片、音乐或字体文件；视觉元素均由项目自有 HTML/CSS 生成。',
    '',
    '## 内容依据',
    '',
    ...spec.evidenceSources.map((source) => `- ${source}`),
    '',
    '## 表述边界',
    '',
    spec.claimBoundary,
    '',
  ].join('\n');
  await fs.writeFile(path.join(outputDir, 'SOURCES.md'), sources, 'utf8');

  if (!report.passed) {
    throw new Error(`图文已生成，但自动质检未通过：${projectRelative(path.join(outputDir, 'qa-report.json'))}`);
  }

  console.log(JSON.stringify({
    contentId: spec.id,
    outputDir: projectRelative(outputDir),
    pages: imagePaths.map(projectRelative),
    overview: projectRelative(path.join(outputDir, 'overview.png')),
    video: projectRelative(videoPath),
    qa: projectRelative(path.join(outputDir, 'qa-report.json')),
    approvedForAutoPublish: false,
  }, null, 2));
}

render().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
