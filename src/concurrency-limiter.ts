/**
 * @fileoverview Core concurrency-limiting scheduler.
 *
 * `ConcurrencyLimiter` enforces a hard cap on the number of async tasks
 * executing simultaneously. Excess tasks are queued and started automatically
 * as running slots are freed, forming a cooperative work-stealing loop between
 * `enqueue` and the `#drain` / `#run` internals.
 *
 * Design decisions:
 *
 * 1. **Slot-recycling via `#drain` in both `enqueue` and `finally`**
 *    `enqueue` calls `#drain` immediately so that a task can claim a free slot
 *    without waiting for another task to finish. The `.finally` handler in
 *    `#run` decrements `#activeCount` and calls `#drain` again so that the
 *    just-freed slot is filled by the next queued item without extra
 *    round-trip or setTimeout tick. Together these two call-sites guarantee
 *    the limiter is always running at full capacity whenever work is available.
 *
 * 2. **`QueueItem<unknown>` internally, `enqueue<T>` externally**
 *    The queue must hold heterogeneous tasks whose result types differ per
 *    call-site. Storing them as `QueueItem<unknown>` lets a single `Array`
 *    contain them all without losing type safety, because the `resolve` and
 *    `reject` callbacks are captured inside the `new Promise<T>` closure where
 *    `T` is still fully known. The type boundary is at `enqueue<T>` — callers
 *    receive a correctly-typed `Promise<T>` regardless of what the queue
 *    stores internally.
 *
 * 3. **`.then/.catch/.finally` over `async/await` inside `#run`**
 *    `async` functions allocate an implicit `Promise` and register a
 *    microtask-boundary on every `await`. Using raw Promise combinators
 *    eliminates that overhead: `#run` stays synchronous until `item.task()`
 *    is called, then hands off to the microtask queue exactly once. This
 *    matters most when the limiter processes thousands of short-lived tasks.
 */

import type {
  AsyncTask,
  ConcurrencyLimiterOptions,
  LimiterStats,
} from './types';

// ─── Internal Queue Item ──────────────────────────────────────────────────────

/**
 * Represents one pending or in-flight work item held by the limiter's queue.
 * Intentionally not re-exported; this is a private implementation detail.
 *
 * @template T The resolved value type of the associated task.
 */
interface QueueItem<T> {
  /** The unit of work to invoke when a concurrency slot opens. */
  task: AsyncTask<T>;
  /** Resolves the outer `Promise<T>` returned by `enqueue`. */
  resolve: (value: T) => void;
  /** Rejects the outer `Promise<T>` returned by `enqueue`. */
  reject: (reason: unknown) => void;
}

// ─── ConcurrencyLimiter ───────────────────────────────────────────────────────

/**
 * Schedules async tasks with a configurable upper bound on simultaneous
 * execution. Tasks that exceed the limit are queued in FIFO order and
 * started as running slots become free.
 *
 * @example
 * ```typescript
 * const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
 *
 * const results = await Promise.all(
 *   urls.map(url =>
 *     limiter.enqueue(() => fetch(url).then(r => r.json()))
 *   )
 * );
 * ```
 */
export class ConcurrencyLimiter {
  // ─── Private State ──────────────────────────────────────────────────────────

  /** Hard cap on simultaneous in-flight tasks. Set once at construction. */
  readonly #maxConcurrent: number;

  /** Number of tasks currently executing (slots in use). */
  #activeCount: number = 0;

  /**
   * FIFO queue of tasks waiting for a concurrency slot.
   * Typed as `QueueItem<unknown>` because the queue is heterogeneous;
   * type safety is preserved through the `resolve`/`reject` closures
   * captured inside each `new Promise<T>` in `enqueue`.
   */
  readonly #queue: Array<QueueItem<unknown>> = [];

  // ─── Constructor ────────────────────────────────────────────────────────────

  /**
   * Creates a new `ConcurrencyLimiter`.
   *
   * @param options - Configuration for the limiter.
   * @throws {RangeError} When `maxConcurrent` is not a positive integer ≥ 1.
   *
   * @example
   * ```typescript
   * const limiter = new ConcurrencyLimiter({ maxConcurrent: 5 });
   * ```
   */
  constructor(options: ConcurrencyLimiterOptions) {
    const { maxConcurrent } = options;

    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError(
        `maxConcurrent must be a positive integer ≥ 1, received: ${maxConcurrent}`,
      );
    }

    this.#maxConcurrent = maxConcurrent;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Submits a task for execution under the concurrency limit.
   *
   * If a slot is immediately available, the task starts on the next
   * microtask tick. If all slots are occupied, the task is queued in FIFO
   * order and started automatically when a running task completes.
   *
   * The returned `Promise<T>` settles with the same value or rejection reason
   * as the task itself — the limiter is transparent to callers.
   *
   * @template T The resolved value type of the task.
   * @param task - A zero-argument function returning a `Promise<T>`.
   * @returns A `Promise<T>` that settles when the task finishes.
   *
   * @example
   * ```typescript
   * const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
   *
   * // Concurrency-limited parallel fetch
   * const data = await limiter.enqueue(() =>
   *   fetch('https://api.example.com/data').then(r => r.json())
   * );
   * ```
   */
  enqueue<T>(task: AsyncTask<T>): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      // The resolve/reject callbacks carry the full generic type T.
      // Casting to QueueItem<unknown> for queue storage is safe because
      // these callbacks are never called with a value outside the Promise<T>
      // closure — the type narrowing happens here, at the enqueue boundary.
      const item: QueueItem<unknown> = {
        task: task as AsyncTask<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      this.#queue.push(item);
    });

    // Attempt to immediately fill an available slot. If no slot is free
    // this call is a no-op and the item waits until #drain is called from
    // the .finally handler of a completing task.
    this.#drain();

    return promise;
  }

  /**
   * Returns a read-only snapshot of the limiter's current runtime state.
   * Each access produces a new plain-object snapshot; mutating the returned
   * object has no effect on the limiter.
   *
   * @returns A `LimiterStats` snapshot.
   *
   * @example
   * ```typescript
   * const { activeCount, queueLength } = limiter.stats;
   * console.log(`${activeCount} running, ${queueLength} waiting`);
   * ```
   */
  get stats(): LimiterStats {
    return {
      maxConcurrent: this.#maxConcurrent,
      activeCount: this.#activeCount,
      queueLength: this.#queue.length,
    };
  }

  // ─── Private Scheduling ─────────────────────────────────────────────────────

  /**
   * Fills all available concurrency slots from the front of the queue.
   *
   * Runs synchronously in a `while` loop so that multiple free slots are
   * claimed in a single call (e.g. after construction with an empty active
   * set). The loop exits as soon as either the slot cap is reached or the
   * queue is exhausted, whichever comes first.
   *
   * Called from two places:
   * - `enqueue`: to grab a slot for the newly added item immediately.
   * - `#run .finally`: to recycle the slot freed by the completing task.
   */
  #drain(): void {
    // Claim as many slots as are currently free and tasks are waiting.
    while (this.#activeCount < this.#maxConcurrent && this.#queue.length > 0) {
      // The non-null assertion is safe: the length guard above ensures
      // shift() cannot return undefined here.
      const item = this.#queue.shift()!;
      this.#run(item);
    }
  }

  /**
   * Executes a single queue item inside a concurrency slot.
   *
   * Increments `#activeCount` before invoking the task and decrements it
   * (then re-drains) in the `.finally` handler, guaranteeing that the slot
   * count stays accurate even when the task rejects.
   *
   * Promise combinators are used instead of `async/await` to avoid the
   * extra microtask boundary and implicit Promise allocation that `async`
   * functions introduce — important for high-throughput workloads.
   *
   * @param item - The queue item whose task is to be executed.
   */
  #run(item: QueueItem<unknown>): void {
    // Claim the slot before the task is invoked.
    this.#activeCount++;

    item
      .task()
      .then(value => {
        // Forward the resolved value to the caller's Promise.
        item.resolve(value);
      })
      .catch(err => {
        // Forward the rejection reason to the caller's Promise.
        item.reject(err);
      })
      .finally(() => {
        // Release the slot and immediately attempt to fill it from the queue.
        // This is the only place #activeCount decreases, keeping the counter
        // consistent regardless of task outcome.
        this.#activeCount--;
        this.#drain();
      });
  }
}
