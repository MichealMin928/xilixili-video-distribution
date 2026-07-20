import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localDir, projectRoot, stateFile } from './paths.js';
import { migrateAppState } from './state-migration.js';
import { platformIds, type AppState, type AuditEvent, type PublishJob } from './types.js';

function initialState(): AppState {
  const now = new Date().toISOString();
  return {
    version: 2,
    installation: {
      projectRoot,
      hostname: os.hostname(),
      initializedAt: now,
    },
    accounts: Object.fromEntries(
      platformIds.map((platform) => [platform, { platform, status: 'unknown' }]),
    ) as AppState['accounts'],
    jobs: [],
    audit: [],
  };
}

export class Store {
  private writeQueue: Promise<void> = Promise.resolve();
  private updateQueue: Promise<void> = Promise.resolve();

  async read(): Promise<AppState> {
    await fs.mkdir(localDir, { recursive: true, mode: 0o700 });
    await fs.chmod(localDir, 0o700);
    try {
      const migration = migrateAppState(JSON.parse(await fs.readFile(stateFile, 'utf8')) as AppState);
      if (migration.changed) await this.write(migration.state);
      return migration.state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const state = initialState();
      await this.write(state);
      return state;
    }
  }

  async write(state: AppState): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
      await fs.chmod(path.dirname(stateFile), 0o700);
      const temporary = `${stateFile}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, stateFile);
    });
    return this.writeQueue;
  }

  async update(mutator: (state: AppState) => void): Promise<AppState> {
    const operation = this.updateQueue.then(async () => {
      const state = await this.read();
      mutator(state);
      await this.write(state);
      return state;
    });
    this.updateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async addAudit(event: Omit<AuditEvent, 'id' | 'at'>): Promise<void> {
    await this.update((state) => {
      state.audit.unshift({ id: randomUUID(), at: new Date().toISOString(), ...event });
      state.audit = state.audit.slice(0, 500);
    });
  }

  async getJob(id: string): Promise<PublishJob> {
    const job = (await this.read()).jobs.find((item) => item.id === id);
    if (!job) throw new Error(`未找到发布任务：${id}`);
    return job;
  }
}
