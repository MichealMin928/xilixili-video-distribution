import fs from 'node:fs/promises';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ACTIVE_SERVICE_LOGS = new Set(['service.out.log', 'service.err.log']);

type CleanupCategory = 'temporary-screenshot' | 'published-proof' | 'engagement-screenshot' | 'verification-screenshot' | 'archived-log';

export interface CleanupCandidate {
  path: string;
  category: CleanupCategory;
  retentionDays: number;
  ageDays: number;
  bytes: number;
}

export interface CleanupResult {
  applied: boolean;
  candidates: CleanupCandidate[];
  deleted: number;
  reclaimedBytes: number;
}

export interface CleanupOptions {
  projectRoot: string;
  apply?: boolean;
  now?: Date;
}

interface CleanupRule {
  directory: string;
  classify: (relativePath: string) => Pick<CleanupCandidate, 'category' | 'retentionDays'> | undefined;
}

interface InternalCandidate extends CleanupCandidate {
  absolutePath: string;
}

function isImage(relativePath: string) {
  return IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function buildRules(projectRoot: string): CleanupRule[] {
  return [
    {
      directory: path.join(projectRoot, '.local', 'logs'),
      classify(relativePath) {
        const name = path.basename(relativePath);
        if (ACTIVE_SERVICE_LOGS.has(name)) return undefined;
        if (!/\.(?:log|old|gz)$/i.test(name)) return undefined;
        return { category: 'archived-log', retentionDays: 30 };
      },
    },
    {
      directory: path.join(projectRoot, 'output', 'engagement'),
      classify(relativePath) {
        return isImage(relativePath)
          ? { category: 'engagement-screenshot', retentionDays: 30 }
          : undefined;
      },
    },
    {
      directory: path.join(projectRoot, 'output', 'playwright'),
      classify(relativePath) {
        if (!isImage(relativePath)) return undefined;
        return /-published\.(?:png|jpe?g|webp)$/i.test(relativePath)
          ? { category: 'published-proof', retentionDays: 365 }
          : { category: 'temporary-screenshot', retentionDays: 30 };
      },
    },
    {
      directory: path.join(projectRoot, 'output', 'verification'),
      classify(relativePath) {
        return isImage(relativePath)
          ? { category: 'verification-screenshot', retentionDays: 30 }
          : undefined;
      },
    },
  ];
}

async function listRegularFiles(directory: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRegularFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function scanCandidates(projectRoot: string, now: Date): Promise<InternalCandidate[]> {
  const candidates: InternalCandidate[] = [];

  for (const rule of buildRules(projectRoot)) {
    for (const relativeToRule of await listRegularFiles(rule.directory)) {
      const policy = rule.classify(relativeToRule);
      if (!policy) continue;

      const absolutePath = path.join(rule.directory, relativeToRule);
      const stat = await fs.stat(absolutePath);
      const ageDays = (now.getTime() - stat.mtimeMs) / DAY_MS;
      if (ageDays <= policy.retentionDays) continue;

      candidates.push({
        absolutePath,
        path: path.relative(projectRoot, absolutePath),
        category: policy.category,
        retentionDays: policy.retentionDays,
        ageDays: Math.floor(ageDays),
        bytes: stat.size,
      });
    }
  }

  return candidates.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

export async function cleanupOldData(options: CleanupOptions): Promise<CleanupResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const candidates = await scanCandidates(projectRoot, options.now ?? new Date());
  const applied = options.apply === true;

  if (applied) {
    for (const candidate of candidates) {
      await fs.unlink(candidate.absolutePath);
    }
  }

  return {
    applied,
    candidates: candidates.map(({ absolutePath: _absolutePath, ...candidate }) => candidate),
    deleted: applied ? candidates.length : 0,
    reclaimedBytes: applied ? candidates.reduce((sum, candidate) => sum + candidate.bytes, 0) : 0,
  };
}
