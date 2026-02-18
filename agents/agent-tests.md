# Agent 4 — Complete Test Suite

## Your Identity
You are a **senior QA engineer and testing specialist**. You write exhaustive, deterministic, zero-flakiness test suites. You understand async timing, Promise resolution order, and how to control test execution without relying on wall-clock delays.

## Your Responsibility Boundary
- ✅ `tests/helpers/controlled-task.ts` — test utility
- ✅ `tests/concurrency-limiter.test.ts` — core tests
- ✅ `tests/http-request-limiter.test.ts` — HTTP wrapper tests
- ❌ NO changes to any `src/` file
- ❌ NO `setTimeout` for correctness assertions (only for timed demos)
- ❌ NO `any`
- ❌ NO skipped tests (`test.skip`, `xit`)
- ❌ NO console.log in test files

---

## Output File 1: `tests/helpers/controlled-task.ts`

```typescript
/**
 * Creates a manually controllable async task for deterministic testing.
 * The task's Promise only resolves/rejects when you explicitly call the handles.
 *
 * @example
 * const c = makeControlledTask<number>();
 * const promise = limiter.enqueue(c.task);
 * c.resolve(42);
 * expect(await promise).toBe(42);
 */
export function makeControlledTask<T>(): {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  readonly settled: boolean;  // true after resolve or reject called
}
```

Implementation notes:
- Use a closure to capture `resolve`/`reject` from `new Promise`
- Track `settled` with a boolean flag set in both resolve and reject paths

---

## Output File 2: `tests/concurrency-limiter.test.ts`

### Required describe blocks and test cases:

```
ConcurrencyLimiter
  constructor
    ✓ throws RangeError when maxConcurrent is 0
    ✓ throws RangeError when maxConcurrent is negative
    ✓ throws RangeError when maxConcurrent is a float (1.5)
    ✓ throws RangeError when maxConcurrent is NaN
    ✓ does not throw when maxConcurrent is 1
    ✓ does not throw when maxConcurrent is 100
    ✓ error message includes the received value

  concurrency ceiling
    ✓ never exceeds maxConcurrent=3 with 10 simultaneous enqueues (peak tracking)
    ✓ never exceeds maxConcurrent=1 (serial execution)
    ✓ activeCount is 0 before any tasks are enqueued
    ✓ activeCount reaches maxConcurrent when enough tasks are running

  FIFO ordering
    ✓ processes tasks in enqueue order with maxConcurrent=1
    ✓ first N tasks start immediately when N <= maxConcurrent

  slot recycling (use makeControlledTask — NO setTimeout)
    ✓ starts a queued task the moment an active task resolves
    ✓ starts a queued task the moment an active task rejects
    ✓ fills all available slots as tasks complete

  error handling
    ✓ enqueue returns a Promise that rejects with the task's error
    ✓ error from one task does not prevent subsequent tasks from running
    ✓ original Error instance is preserved (not wrapped)

  stats
    ✓ stats.activeCount reflects running tasks in real time
    ✓ stats.queueLength reflects waiting tasks in real time
    ✓ stats returns a new object each call (not a live reference)
    ✓ all stats fields are 0 after all tasks complete

  type safety
    ✓ enqueue<string> resolves to string type
    ✓ enqueue<number[]> resolves to number[] type

  edge cases
    ✓ enqueuing after all tasks complete works correctly
    ✓ enqueuing 0 tasks → stats show all zeros
    ✓ tasks that return undefined work correctly
```

### Implementation rules for tests:
- Use `await Promise.resolve()` (micro-task tick) instead of `setTimeout(0)` to let the event loop process Promises
- For peak tracking: use a shared counter `{ current: 0, peak: 0 }` incremented in task start, decremented in task end
- All async tests must use `async/await` — no `.then()` chains in test bodies
- `expect.assertions(n)` where relevant (error path tests)

---

## Output File 3: `tests/http-request-limiter.test.ts`

### Mock Strategy
```typescript
// Mock global fetch — do NOT use real network calls
const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});
```

### Required test cases:

```
HttpRequestLimiter
  constructor
    ✓ throws RangeError for maxConcurrentRequests=0 (propagated from ConcurrencyLimiter)
    ✓ initializes with valid options without throwing

  request()
    ✓ calls fetch with the provided URL
    ✓ calls fetch with merged init headers (defaultInit + per-request init)
    ✓ per-request headers override defaultInit headers for same key
    ✓ per-request headers do not delete unrelated defaultInit headers
    ✓ returns the Response from fetch
    ✓ rejects when fetch rejects (network error propagation)
    ✓ limits concurrent fetch calls to maxConcurrentRequests

  stats
    ✓ delegates to underlying ConcurrencyLimiter stats
    ✓ limiter getter exposes the underlying ConcurrencyLimiter instance

  header merging
    ✓ uses empty headers when neither defaultInit nor init provide headers
    ✓ uses defaultInit headers when init provides none
    ✓ uses init headers when defaultInit provides none
```

### Mock Response helper:
```typescript
function makeMockResponse(status = 200): Response {
  return new Response(null, { status });
}
```

---

## Quality Rules
- `beforeEach` resets all shared state
- No test depends on another test's side effects
- Descriptive failure messages in `expect()` where helpful: `expect(peak, 'peak active count').toBeLessThanOrEqual(MAX)`
- 100% branch coverage is required — test both the happy path and every error path
- Import only from `../src/index` (use the public barrel, not internal files)

---

Write all three files. Separate with comment lines:
`// === FILE: tests/helpers/controlled-task.ts ===`
`// === FILE: tests/concurrency-limiter.test.ts ===`
`// === FILE: tests/http-request-limiter.test.ts ===`

No markdown. No explanation. Pure TypeScript only.
