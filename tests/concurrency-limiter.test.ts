import { ConcurrencyLimiter } from '../src/index';
import { makeControlledTask } from './helpers/controlled-task';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush the microtask queue enough times for deeply-chained promise
 *  handlers (then → catch → finally → re-drain) to settle. */
async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ConcurrencyLimiter', () => {
  // ── constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('throws RangeError when maxConcurrent is 0', () => {
      expect(() => new ConcurrencyLimiter({ maxConcurrent: 0 })).toThrow(RangeError);
    });

    it('throws RangeError when maxConcurrent is negative', () => {
      expect(() => new ConcurrencyLimiter({ maxConcurrent: -1 })).toThrow(RangeError);
    });

    it('throws RangeError when maxConcurrent is a float (1.5)', () => {
      expect(() => new ConcurrencyLimiter({ maxConcurrent: 1.5 })).toThrow(RangeError);
    });

    it('throws RangeError when maxConcurrent is NaN', () => {
      expect(() => new ConcurrencyLimiter({ maxConcurrent: NaN })).toThrow(RangeError);
    });

    it('does not throw when maxConcurrent is 1', () => {
      expect(() => new ConcurrencyLimiter({ maxConcurrent: 1 })).not.toThrow();
    });

    it('does not throw when maxConcurrent is 100', () => {
      expect(() => new ConcurrencyLimiter({ maxConcurrent: 100 })).not.toThrow();
    });

    it('error message includes the received value', () => {
      expect(() => new ConcurrencyLimiter({ maxConcurrent: -7 })).toThrow('-7');
    });
  });

  // ── concurrency ceiling ──────────────────────────────────────────────────

  describe('concurrency ceiling', () => {
    it('never exceeds maxConcurrent=3 with 10 simultaneous enqueues (peak tracking)', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
      const tracker = { current: 0, peak: 0 };

      // Each controlled task acts as a gate: we track concurrency around it.
      const controls = Array.from({ length: 10 }, () => makeControlledTask<void>());

      const promises = controls.map(c =>
        limiter.enqueue(async () => {
          tracker.current++;
          if (tracker.current > tracker.peak) tracker.peak = tracker.current;
          await c.task();
          tracker.current--;
        }),
      );

      // Flush so the first 3 tasks start
      await flushMicrotasks();

      // Resolve tasks one at a time, allowing the next queued task to start
      for (const c of controls) {
        c.resolve();
        await flushMicrotasks();
      }

      await Promise.all(promises);
      expect(tracker.peak).toBe(3);
    });

    it('never exceeds maxConcurrent=1 (serial execution)', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const tracker = { current: 0, peak: 0 };

      const controls = Array.from({ length: 5 }, () => makeControlledTask<void>());

      const promises = controls.map(c =>
        limiter.enqueue(async () => {
          tracker.current++;
          if (tracker.current > tracker.peak) tracker.peak = tracker.current;
          await c.task();
          tracker.current--;
        }),
      );

      await flushMicrotasks();

      for (const c of controls) {
        c.resolve();
        await flushMicrotasks();
      }

      await Promise.all(promises);
      expect(tracker.peak).toBe(1);
    });

    it('activeCount is 0 before any tasks are enqueued', () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 5 });
      expect(limiter.stats.activeCount).toBe(0);
    });

    it('activeCount reaches maxConcurrent when enough tasks are running', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
      const controls = Array.from({ length: 3 }, () => makeControlledTask<void>());

      controls.forEach(c => {
        limiter.enqueue(c.task);
      });

      await flushMicrotasks();
      expect(limiter.stats.activeCount).toBe(3);

      // Cleanup
      controls.forEach(c => c.resolve());
      await flushMicrotasks();
    });
  });

  // ── FIFO ordering ────────────────────────────────────────────────────────

  describe('FIFO ordering', () => {
    it('processes tasks in enqueue order with maxConcurrent=1', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const order: number[] = [];

      const controls = [
        makeControlledTask<void>(),
        makeControlledTask<void>(),
        makeControlledTask<void>(),
      ];

      const promises = controls.map((c, idx) =>
        limiter.enqueue(async () => {
          await c.task();
          order.push(idx);
        }),
      );

      await flushMicrotasks();

      // Resolve in enqueue order
      for (const c of controls) {
        c.resolve();
        await flushMicrotasks();
      }

      await Promise.all(promises);
      expect(order).toEqual([0, 1, 2]);
    });

    it('first N tasks start immediately when N <= maxConcurrent', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
      const started: number[] = [];

      const controls = Array.from({ length: 5 }, () => makeControlledTask<void>());

      controls.forEach((c, idx) => {
        limiter.enqueue(async () => {
          started.push(idx);
          await c.task();
        });
      });

      await flushMicrotasks();

      // Only the first 3 should have started
      expect(started).toEqual([0, 1, 2]);

      // Cleanup
      controls.forEach(c => c.resolve());
      await flushMicrotasks();
    });
  });

  // ── slot recycling ───────────────────────────────────────────────────────

  describe('slot recycling (use makeControlledTask — NO setTimeout)', () => {
    it('starts a queued task the moment an active task resolves', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });

      const first = makeControlledTask<number>();
      const second = makeControlledTask<number>();

      const started: number[] = [];

      limiter.enqueue(async () => {
        started.push(0);
        return first.task();
      });

      limiter.enqueue(async () => {
        started.push(1);
        return second.task();
      });

      await flushMicrotasks();
      expect(started).toEqual([0]);

      // Resolve the first task — the second should start
      first.resolve(1);
      await flushMicrotasks();
      expect(started).toEqual([0, 1]);

      second.resolve(2);
      await flushMicrotasks();
    });

    it('starts a queued task the moment an active task rejects', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });

      const first = makeControlledTask<number>();
      const second = makeControlledTask<number>();

      const started: number[] = [];

      const p1 = limiter.enqueue(async () => {
        started.push(0);
        return first.task();
      });

      limiter.enqueue(async () => {
        started.push(1);
        return second.task();
      });

      await flushMicrotasks();
      expect(started).toEqual([0]);

      // Reject the first task — the second should still start
      first.reject(new Error('first failed'));
      await flushMicrotasks();
      expect(started).toEqual([0, 1]);

      // Suppress unhandled rejection
      await p1.catch(() => undefined);
      second.resolve(2);
      await flushMicrotasks();
    });

    it('fills all available slots as tasks complete', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });

      const controls = Array.from({ length: 4 }, () => makeControlledTask<void>());
      const started: number[] = [];

      const promises = controls.map((c, idx) =>
        limiter.enqueue(async () => {
          started.push(idx);
          await c.task();
        }),
      );

      await flushMicrotasks();
      // First 2 start immediately
      expect(started).toEqual([0, 1]);

      // Resolve task 0, task 2 should start
      controls[0]!.resolve();
      await flushMicrotasks();
      expect(started).toEqual([0, 1, 2]);

      // Resolve task 1, task 3 should start
      controls[1]!.resolve();
      await flushMicrotasks();
      expect(started).toEqual([0, 1, 2, 3]);

      controls[2]!.resolve();
      controls[3]!.resolve();
      await Promise.all(promises);
    });
  });

  // ── error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it("enqueue returns a Promise that rejects with the task's error", async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const err = new Error('task error');

      await expect(
        limiter.enqueue(() => Promise.reject(err)),
      ).rejects.toThrow('task error');
    });

    it('error from one task does not prevent subsequent tasks from running', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });

      const p1 = limiter.enqueue(() => Promise.reject(new Error('fail'))).catch(() => 'caught');
      const p2 = limiter.enqueue(async () => 'success');

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('caught');
      expect(r2).toBe('success');
    });

    it('original Error instance is preserved (not wrapped)', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const original = new TypeError('original type error');

      let caught: unknown;
      try {
        await limiter.enqueue(() => Promise.reject(original));
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(original);
    });
  });

  // ── stats ────────────────────────────────────────────────────────────────

  describe('stats', () => {
    it('stats.activeCount reflects running tasks in real time', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
      const c1 = makeControlledTask<void>();
      const c2 = makeControlledTask<void>();

      limiter.enqueue(c1.task);
      limiter.enqueue(c2.task);

      await flushMicrotasks();
      expect(limiter.stats.activeCount).toBe(2);

      c1.resolve();
      await flushMicrotasks();
      expect(limiter.stats.activeCount).toBe(1);

      c2.resolve();
      await flushMicrotasks();
      expect(limiter.stats.activeCount).toBe(0);
    });

    it('stats.queueLength reflects waiting tasks in real time', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const c1 = makeControlledTask<void>();
      const c2 = makeControlledTask<void>();
      const c3 = makeControlledTask<void>();

      limiter.enqueue(c1.task);
      limiter.enqueue(c2.task);
      limiter.enqueue(c3.task);

      await flushMicrotasks();
      // 1 active, 2 waiting
      expect(limiter.stats.queueLength).toBe(2);

      c1.resolve();
      await flushMicrotasks();
      // 1 active (c2), 1 waiting (c3)
      expect(limiter.stats.queueLength).toBe(1);

      c2.resolve();
      await flushMicrotasks();
      expect(limiter.stats.queueLength).toBe(0);

      c3.resolve();
      await flushMicrotasks();
    });

    it('stats returns a new object each call (not a live reference)', () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 5 });
      const stats1 = limiter.stats;
      const stats2 = limiter.stats;
      expect(Object.is(stats1, stats2)).toBe(false);
    });

    it('all stats fields are 0 after all tasks complete', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
      const controls = Array.from({ length: 3 }, () => makeControlledTask<void>());

      const promises = controls.map(c => limiter.enqueue(c.task));

      await flushMicrotasks();
      controls.forEach(c => c.resolve());
      await Promise.all(promises);
      await flushMicrotasks();

      const { activeCount, queueLength } = limiter.stats;
      expect(activeCount).toBe(0);
      expect(queueLength).toBe(0);
    });
  });

  // ── type safety ──────────────────────────────────────────────────────────

  describe('type safety', () => {
    it('enqueue<string> resolves to string type', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const result: string = await limiter.enqueue(async () => 'hello');
      expect(result).toBe('hello');
    });

    it('enqueue<number[]> resolves to number[] type', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const result: number[] = await limiter.enqueue(async () => [1, 2, 3]);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  // ── edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('enqueuing after all tasks complete works correctly', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });

      const first = await limiter.enqueue(async () => 'first');
      expect(first).toBe('first');

      // Enqueue again after fully drained
      const second = await limiter.enqueue(async () => 'second');
      expect(second).toBe('second');
    });

    it('enqueuing 0 tasks → stats show all zeros', () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 5 });
      const { activeCount, queueLength } = limiter.stats;
      expect(activeCount).toBe(0);
      expect(queueLength).toBe(0);
    });

    it('tasks that return undefined work correctly', async () => {
      const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
      const result: undefined = await limiter.enqueue(async (): Promise<undefined> => undefined);
      expect(result).toBeUndefined();
    });
  });
});
