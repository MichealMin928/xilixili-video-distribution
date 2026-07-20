import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot as defaultProjectRoot } from './paths.js';
import { platformIds, type AppState, type InstallationState } from './types.js';

interface MigrationOptions {
  projectRoot?: string;
  hostname?: string;
  now?: string;
  pathExists?: (candidate: string) => boolean;
}

interface LegacyState extends Omit<AppState, 'version' | 'installation'> {
  version?: number;
  installation?: InstallationState;
}

export interface StateMigrationResult {
  state: AppState;
  changed: boolean;
  relocatedPaths: number;
  resetAccounts: boolean;
}

const portableRoots = ['content', 'output', 'records', 'tmp'];

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function relocatePath(
  value: string,
  currentRoot: string,
  previousRoot: string | undefined,
  pathExists: (candidate: string) => boolean,
): string {
  if (!path.isAbsolute(value) || isInside(currentRoot, value)) return value;

  if (previousRoot && isInside(previousRoot, value)) {
    const candidate = path.join(currentRoot, path.relative(previousRoot, value));
    if (pathExists(candidate)) return candidate;
  }

  const segments = path.normalize(value).split(path.sep);
  for (const directory of portableRoots) {
    const index = segments.lastIndexOf(directory);
    if (index >= 0) {
      const candidate = path.join(currentRoot, ...segments.slice(index));
      if (pathExists(candidate)) return candidate;
    }
  }
  return value;
}

export function migrateAppState(
  input: AppState | LegacyState,
  options: MigrationOptions = {},
): StateMigrationResult {
  const currentRoot = path.resolve(options.projectRoot ?? defaultProjectRoot);
  const hostname = options.hostname ?? os.hostname();
  const now = options.now ?? new Date().toISOString();
  const pathExists = options.pathExists ?? fs.existsSync;
  const state = input as LegacyState;
  const previousRoot = state.installation?.projectRoot;
  const legacyVersion = state.version !== 2;
  const rootChanged = Boolean(previousRoot && path.resolve(previousRoot) !== currentRoot);
  let relocatedPaths = 0;

  const relocate = (value: string | undefined): string | undefined => {
    if (!value) return value;
    const relocated = relocatePath(value, currentRoot, previousRoot, pathExists);
    if (relocated !== value) relocatedPaths += 1;
    return relocated;
  };

  for (const job of state.jobs ?? []) {
    job.mediaPaths = job.mediaPaths.map((value) => relocate(value) ?? value);
    if (job.source) job.source.manifestPath = relocate(job.source.manifestPath) ?? job.source.manifestPath;
    for (const result of job.results) result.screenshot = relocate(result.screenshot);
  }

  const resetAccounts = legacyVersion || rootChanged;
  const accounts = state.accounts ?? {} as AppState['accounts'];
  for (const platform of platformIds) {
    const account = accounts[platform] ?? { platform, status: 'unknown' as const };
    if (resetAccounts) {
      account.status = 'unknown';
      account.note = '系统已迁移，请在本机重新检查登录态。';
      delete account.checkedAt;
      delete account.pageUrl;
    }
    accounts[platform] = account;
  }
  state.accounts = accounts;

  const changed = legacyVersion || rootChanged || relocatedPaths > 0 || !state.installation;
  if (changed) {
    state.audit ??= [];
    state.audit.unshift({
      id: randomUUID(),
      at: now,
      action: 'system.migrated',
      detail: `迁移自检完成：修复 ${relocatedPaths} 条本机路径，账号登录态需重新确认。`,
      outcome: 'warning',
    });
    state.audit = state.audit.slice(0, 500);
  }

  state.version = 2;
  state.installation = {
    projectRoot: currentRoot,
    hostname,
    initializedAt: state.installation?.initializedAt ?? now,
    migratedAt: changed ? now : state.installation?.migratedAt,
  };

  return {
    state: state as AppState,
    changed,
    relocatedPaths,
    resetAccounts,
  };
}
