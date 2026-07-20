import { cleanupOldData } from '../core/cleanup.js';
import { projectRoot } from '../core/paths.js';

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--apply');
  if (unknown.length > 0) {
    throw new Error(`未知参数：${unknown.join(', ')}。可用参数只有 --apply。`);
  }

  const result = await cleanupOldData({
    projectRoot,
    apply: args.includes('--apply'),
  });

  console.log(JSON.stringify({
    mode: result.applied ? 'applied' : 'dry-run',
    candidates: result.candidates,
    candidateCount: result.candidates.length,
    deleted: result.deleted,
    reclaimedBytes: result.reclaimedBytes,
    protected: [
      'content/',
      'records/',
      '.local/state.json',
      '.local/engagement.json',
      '.local/chrome-profile/',
      '.local/logs/service.out.log',
      '.local/logs/service.err.log',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
