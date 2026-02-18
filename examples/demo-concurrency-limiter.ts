/**
 * Demo: ConcurrencyLimiter
 *
 * Enqueues 8 tasks that each take ~500ms.
 * With maxConcurrent=3, you'll see only 3 running at any moment.
 *
 * Run: npx ts-node examples/demo-concurrency-limiter.ts
 */

import { ConcurrencyLimiter } from '../src/index';

const MAX = 3;
const TASKS = 8;
const TASK_DURATION_MS = 500;

const limiter = new ConcurrencyLimiter({ maxConcurrent: MAX });

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeTask(id: number) {
  return () =>
    new Promise<string>(async resolve => {
      const { activeCount, queueLength } = limiter.stats;
      console.log(`  [task ${id}] started  | active: ${activeCount} | queued: ${queueLength}`);
      await delay(TASK_DURATION_MS);
      console.log(`  [task ${id}] finished`);
      resolve(`result-${id}`);
    });
}

async function main() {
  console.log(`\nConcurrencyLimiter demo`);
  console.log(`  tasks: ${TASKS}  |  maxConcurrent: ${MAX}  |  each task: ${TASK_DURATION_MS}ms\n`);

  const start = Date.now();

  const promises = Array.from({ length: TASKS }, (_, i) =>
    limiter.enqueue(makeTask(i + 1))
  );

  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;

  console.log(`\nAll done in ${elapsed}ms`);
  console.log(`Results: ${results.join(', ')}`);
  console.log(`\nExpected ~${Math.ceil(TASKS / MAX) * TASK_DURATION_MS}ms (${Math.ceil(TASKS / MAX)} batches × ${TASK_DURATION_MS}ms)`);
  console.log(`Without limiter it would be ~${TASK_DURATION_MS}ms (all parallel)`);
}

main();
