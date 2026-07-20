import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupOldData } from './cleanup.js';

const temporaryRoots: string[] = [];
const now = new Date('2026-07-19T10:00:00.000Z');

async function createFile(root: string, relativePath: string, ageDays: number, content = 'data') {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  const modifiedAt = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
  await fs.utimes(filePath, modifiedAt, modifiedAt);
  return filePath;
}

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xilixili-cleanup-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('old data cleanup', () => {
  it('only selects allowlisted, expired, regenerable files', async () => {
    const root = await createProject();
    const expiredTemporary = await createFile(root, 'output/playwright/job-douyin-prepared.png', 31);
    const recentTemporary = await createFile(root, 'output/playwright/job-kuaishou-prepared.png', 29);
    const retainedProof = await createFile(root, 'output/playwright/job-douyin-published.png', 364);
    const expiredProof = await createFile(root, 'output/playwright/job-kuaishou-published.png', 366);
    const expiredEngagement = await createFile(root, 'output/engagement/old-check.png', 31);
    const expiredVerification = await createFile(root, 'output/verification/old-check.jpg', 31);
    const expiredRotatedLog = await createFile(root, '.local/logs/service.out.1.log', 31);
    const protectedActiveLog = await createFile(root, '.local/logs/service.out.log', 400);
    const protectedState = await createFile(root, '.local/state.json', 400);
    const protectedContent = await createFile(root, 'content/archive/manifest.json', 400);

    const result = await cleanupOldData({ projectRoot: root, now, apply: false });
    const selected = result.candidates.map((candidate) => candidate.path);

    expect(selected).toEqual([
      path.relative(root, expiredRotatedLog),
      path.relative(root, expiredEngagement),
      path.relative(root, expiredTemporary),
      path.relative(root, expiredProof),
      path.relative(root, expiredVerification),
    ].sort());
    expect(selected).not.toContain(path.relative(root, recentTemporary));
    expect(selected).not.toContain(path.relative(root, retainedProof));
    expect(selected).not.toContain(path.relative(root, protectedActiveLog));
    expect(selected).not.toContain(path.relative(root, protectedState));
    expect(selected).not.toContain(path.relative(root, protectedContent));
    await expect(fs.access(expiredTemporary)).resolves.toBeUndefined();
    expect(result.applied).toBe(false);
  });

  it('deletes selected files in apply mode and leaves protected paths intact', async () => {
    const root = await createProject();
    const expiredTemporary = await createFile(root, 'output/playwright/job-prepare-error.png', 31, 'remove me');
    const protectedContent = await createFile(root, 'content/keep-me.png', 400, 'keep me');
    const linkedContent = path.join(root, 'output/playwright/linked-content.png');
    await fs.symlink(protectedContent, linkedContent);

    const result = await cleanupOldData({ projectRoot: root, now, apply: true });

    expect(result.applied).toBe(true);
    expect(result.deleted).toBe(1);
    expect(result.reclaimedBytes).toBe(Buffer.byteLength('remove me'));
    await expect(fs.access(expiredTemporary)).rejects.toThrow();
    await expect(fs.access(protectedContent)).resolves.toBeUndefined();
    await expect(fs.access(linkedContent)).resolves.toBeUndefined();
  });
});
