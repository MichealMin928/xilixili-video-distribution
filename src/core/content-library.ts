import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertPublicFacingCopy } from './content-policy.js';
import { contentManifestSchema } from './daily.js';
import type { ContentKind, PlatformId } from './types.js';

const supportedMediaExtensions = new Set([
  '.gif', '.jpeg', '.jpg', '.m4v', '.mov', '.mp4', '.png', '.webm', '.webp',
]);

export interface ContentAsset {
  id: string;
  manifestPath: string;
  title: string;
  body: string;
  hashtags: string[];
  kind: ContentKind;
  watermarkFreeConfirmed: boolean;
  targets: PlatformId[];
  source: string;
  theme: string;
  mediaFiles: string[];
  modifiedAt: string;
}

async function walkManifests(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name.toLowerCase() === 'archive' ? [] : walkManifests(entryPath);
    }
    return entry.isFile() && entry.name === 'manifest.json' ? [entryPath] : [];
  }));
  return nested.flat();
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export async function resolveContentMediaFile(
  projectRoot: string,
  candidate: string,
): Promise<string | undefined> {
  const contentRoot = await fs.realpath(path.join(projectRoot, 'content')).catch(() => undefined);
  if (!contentRoot) return undefined;

  const absolute = path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(projectRoot, candidate);
  const stats = await fs.lstat(absolute).catch(() => undefined);
  if (!stats?.isFile() || stats.isSymbolicLink()) return undefined;

  const realPath = await fs.realpath(absolute).catch(() => undefined);
  if (!realPath || !isInside(contentRoot, realPath)) return undefined;
  if (!supportedMediaExtensions.has(path.extname(realPath).toLowerCase())) return undefined;
  return realPath;
}

export async function loadContentAsset(
  projectRoot: string,
  manifestPath: string,
): Promise<ContentAsset | undefined> {
  try {
    const contentRoot = await fs.realpath(path.join(projectRoot, 'content'));
    const manifestStats = await fs.lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) return undefined;
    const realManifestPath = await fs.realpath(manifestPath);
    if (!isInside(contentRoot, realManifestPath)) return undefined;
    const relativeToContent = path.relative(contentRoot, realManifestPath);
    if (relativeToContent.split(path.sep).some((part) => part.toLowerCase() === 'archive')) return undefined;

    const parsed = contentManifestSchema.parse(JSON.parse(await fs.readFile(realManifestPath, 'utf8')));
    assertPublicFacingCopy(parsed);
    const resolvedMedia = await Promise.all(
      parsed.mediaPaths.map((item) => resolveContentMediaFile(projectRoot, item)),
    );
    if (resolvedMedia.some((item) => !item)) return undefined;

    const relativeManifest = path.relative(projectRoot, realManifestPath);
    return {
      id: createHash('sha256').update(relativeManifest).digest('hex').slice(0, 16),
      manifestPath: realManifestPath,
      title: parsed.title,
      body: parsed.body,
      hashtags: parsed.hashtags,
      kind: parsed.kind,
      watermarkFreeConfirmed: parsed.kind === 'gallery' || parsed.watermarkFreeConfirmed,
      targets: parsed.targets,
      source: path.relative(contentRoot, path.dirname(realManifestPath)) || 'content',
      theme: parsed.hashtags[0] ?? '酒店投影',
      mediaFiles: resolvedMedia as string[],
      modifiedAt: manifestStats.mtime.toISOString(),
    };
  } catch {
    return undefined;
  }
}

export async function discoverContentAssets(projectRoot: string): Promise<ContentAsset[]> {
  const contentRoot = path.join(projectRoot, 'content');
  const manifests = await walkManifests(contentRoot);
  const assets = await Promise.all(manifests.map((manifestPath) => loadContentAsset(projectRoot, manifestPath)));

  return assets
    .filter((asset): asset is ContentAsset => Boolean(asset))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}
