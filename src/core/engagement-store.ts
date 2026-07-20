import fs from 'node:fs/promises';
import path from 'node:path';
import { engagementStateFile, localDir } from './paths.js';
import type { EngagementItem, EngagementReport, EngagementState } from './types.js';
import { isEngagementNoise } from './engagement.js';

function initialState(): EngagementState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    items: [],
    reports: [],
  };
}

export class EngagementStore {
  private writeQueue: Promise<void> = Promise.resolve();

  async read(): Promise<EngagementState> {
    await fs.mkdir(localDir, { recursive: true, mode: 0o700 });
    await fs.chmod(localDir, 0o700);
    try {
      const parsed = JSON.parse(await fs.readFile(engagementStateFile, 'utf8')) as EngagementState;
      if (parsed.version !== 1 || !Array.isArray(parsed.items) || !Array.isArray(parsed.reports)) {
        throw new Error('互动巡检状态文件格式不受支持。');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const state = initialState();
      await this.write(state);
      return state;
    }
  }

  async write(state: EngagementState): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(engagementStateFile), { recursive: true, mode: 0o700 });
      const temporary = `${engagementStateFile}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, engagementStateFile);
      await fs.chmod(engagementStateFile, 0o600);
    });
    return this.writeQueue;
  }

  async mergeReport(report: Omit<EngagementReport, 'baseline' | 'newItemIds' | 'summary'>): Promise<EngagementReport> {
    const state = await this.read();
    const retainedItems = state.items.filter((item) => !isEngagementNoise(item));
    const existingIds = new Set(retainedItems.map((item) => item.id));
    const visibleItems = report.surfaces.flatMap((surface) => surface.items).filter((item) => !isEngagementNoise(item));
    const uniqueVisible = [...new Map(visibleItems.map((item) => [item.id, item])).values()];
    const newItems = uniqueVisible.filter((item) => !existingIds.has(item.id));
    const baseline = state.reports.length === 0;
    const completed: EngagementReport = {
      ...report,
      baseline,
      newItemIds: newItems.map((item) => item.id),
      summary: {
        visibleItems: uniqueVisible.length,
        newItems: newItems.length,
        highPriority: newItems.filter((item) => item.priority === 'high').length,
        mediumPriority: newItems.filter((item) => item.priority === 'medium').length,
        manualRequired: report.surfaces.filter((surface) => surface.status === 'manual_required'
          || surface.status === 'logged_out' || surface.status === 'needs_verification').length,
        failed: report.surfaces.filter((surface) => surface.status === 'failed').length,
      },
    };
    const mergedItems: EngagementItem[] = [...newItems, ...retainedItems]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 500);
    await this.write({
      version: 1,
      updatedAt: report.completedAt,
      items: mergedItems,
      reports: [completed, ...state.reports].slice(0, 60),
    });
    return completed;
  }
}
