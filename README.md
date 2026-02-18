# concurrency-limiter

A production-grade TypeScript library that controls how many async tasks or HTTP requests run simultaneously. Excess work is queued automatically and starts the moment a slot frees up — no polling, no timers, no external dependencies.

**42 tests · 100% coverage · strict TypeScript · zero dependencies**

---

## Table of Contents

- [When to use this](#when-to-use-this)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Examples](#examples)
- [Usage](#usage)
  - [ConcurrencyLimiter](#concurrencylimiter)
  - [HttpRequestLimiter](#httprequestlimiter)
  - [Header merging](#header-merging)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Test coverage](#test-coverage)
- [Requirements audit](#requirements-audit)
- [Design notes](#design-notes)

---

## When to use this

| Scenario | Without limiter | With limiter |
|---|---|---|
| Fetch 500 URLs at once | 500 simultaneous connections, likely rate-limited or OOM | Max N in-flight, rest queue automatically |
| Batch DB writes | All fire at once, connection pool exhausted | Controlled throughput |
| Parallel API calls | Hit rate limits, get 429s | Stay within API's concurrency budget |
| Any `Promise.all` that feels dangerous | Unbounded parallelism | Hard ceiling you control |

---

## How it works

```
enqueue(task) ──► slot free? ──► YES ──► run immediately
                      │
                      NO
                      │
                      ▼
                   queue (FIFO)
                      │
                  task finishes (success or error)
                      │
                      ▼
                  next task starts
```

The scheduler runs at full capacity whenever work is available. The moment any task finishes — whether it resolved or rejected — the next queued task claims its slot automatically.

---

## Getting started

```bash
git clone https://github.com/Moshe-I-Amar/concurrency-limiter.git
cd concurrency-limiter
npm install

npm test                  # run the test suite
npm run test:coverage     # tests + coverage report
npm run build             # compile TypeScript → dist/
```

---

## Examples

See the limiter in action with two runnable demos:

```bash
# 8 local tasks, maxConcurrent=3 — no internet needed
npm run example:limiter

# 6 real HTTP requests, maxConcurrentRequests=2 — requires internet
npm run example:http
```

**`npm run example:limiter` output:**
```
ConcurrencyLimiter demo
  tasks: 8  |  maxConcurrent: 3  |  each task: 500ms

  [task 1] started  | active: 1 | queued: 0
  [task 2] started  | active: 2 | queued: 0
  [task 3] started  | active: 3 | queued: 0
  [task 1] finished
  [task 4] started  | active: 3 | queued: 4
  [task 2] finished
  [task 5] started  | active: 3 | queued: 3
  [task 3] finished
  [task 6] started  | active: 3 | queued: 2
  [task 4] finished
  [task 7] started  | active: 3 | queued: 1
  [task 5] finished
  [task 8] started  | active: 3 | queued: 0
  [task 6] finished
  [task 7] finished
  [task 8] finished

All done in 1529ms
Results: result-1, result-2, result-3, result-4, result-5, result-6, result-7, result-8

Expected ~1500ms (3 batches × 500ms)
Without limiter it would be ~500ms (all parallel)
```

> Notice: `active` never exceeds 3. The moment one task finishes, the next starts.

**`npm run example:http` output:**
```
HttpRequestLimiter demo
  requests: 6  |  maxConcurrentRequests: 2

  [post 1] enqueued | active: 0 | queued: 0
  [post 2] enqueued | active: 1 | queued: 0
  [post 3] enqueued | active: 2 | queued: 0
  [post 4] enqueued | active: 2 | queued: 1
  [post 5] enqueued | active: 2 | queued: 2
  [post 6] enqueued | active: 2 | queued: 3
  [post 1] done     | "sunt aut facere repellat provident occae..."
  [post 2] done     | "qui est esse..."
  [post 4] done     | "eum et est occaecati..."
  [post 5] done     | "nesciunt quas odio..."
  [post 3] done     | "ea molestias quasi exercitationem repell..."
  [post 6] done     | "dolorem eum magni eos aperiam quia..."

Fetched 6 posts in 711ms
Max concurrent requests was capped at 2
```

> Notice: once 2 slots are full, new requests queue immediately. Responses arrive out of order (network timing), but all 6 complete.

---

## Usage

### ConcurrencyLimiter

Works with **any** `() => Promise<T>` — HTTP, database queries, file I/O, CPU-bound work, anything async.

```typescript
import { ConcurrencyLimiter } from './src/index';

const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });

// 10 tasks enqueued — only 3 run at a time, rest queue automatically
const results = await Promise.all(
  items.map(item => limiter.enqueue(() => processItem(item)))
);

// Inspect live state at any point
const { activeCount, queueLength, maxConcurrent } = limiter.stats;
console.log(`${activeCount} running, ${queueLength} waiting`);
```

### HttpRequestLimiter

A thin wrapper around `fetch` with a built-in concurrency limit and default header support.

```typescript
import { HttpRequestLimiter } from './src/index';

const api = new HttpRequestLimiter({
  maxConcurrentRequests: 5,
  defaultInit: {
    headers: {
      'Authorization': 'Bearer token',
      'Accept': 'application/json',
    },
  },
});

// At most 5 requests in-flight simultaneously
const responses = await Promise.all(
  userIds.map(id => api.request(`https://api.example.com/users/${id}`))
);

// Per-request options work exactly like fetch — headers are merged, not replaced
const response = await api.request('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'widget' }),
});

if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
```

### Header merging

Default headers and per-request headers are merged **key-by-key**. Per-request values win on conflicts; unrelated defaults are always preserved.

```typescript
// defaultInit.headers:  { Authorization: 'Bearer token', Accept: 'application/json' }
// per-request headers:  { Accept: 'text/csv', 'X-Request-Id': '123' }
// ─────────────────────────────────────────────────────────────────────
// merged result:        { Authorization: 'Bearer token',   ← preserved
//                         Accept: 'text/csv',               ← overridden
//                         'X-Request-Id': '123' }           ← added
```

A plain `{ ...defaultInit, ...init }` spread would silently drop all default headers whenever a request supplies any headers. The key-by-key merge prevents that.

---

## API reference

### `ConcurrencyLimiter`

```typescript
new ConcurrencyLimiter(options: ConcurrencyLimiterOptions)
```

Throws `RangeError` if `maxConcurrent` is not a positive integer ≥ 1.

| Member | Signature | Description |
|---|---|---|
| `enqueue(task)` | `<T>(task: AsyncTask<T>) => Promise<T>` | Submit any async task. Returns a Promise that settles identically to the task. |
| `stats` | `LimiterStats` | Read-only snapshot of `maxConcurrent`, `activeCount`, `queueLength`. Each access returns a new object. |

### `HttpRequestLimiter`

```typescript
new HttpRequestLimiter(options: HttpRequestOptions)
```

Throws `RangeError` if `maxConcurrentRequests` is not a positive integer ≥ 1.

| Member | Signature | Description |
|---|---|---|
| `request(input, init?)` | `(input: string \| URL \| Request, init?: RequestInit) => Promise<Response>` | Enqueue a fetch call. Propagates network errors; HTTP 4xx/5xx do not throw — check `response.ok`. |
| `stats` | `LimiterStats` | Delegates to the underlying `ConcurrencyLimiter`. |
| `limiter` | `ConcurrencyLimiter` | Exposes the underlying limiter for advanced use (e.g. mixing HTTP and non-HTTP tasks on the same slot budget). |

### Types

```typescript
type AsyncTask<T> = () => Promise<T>;

interface ConcurrencyLimiterOptions {
  maxConcurrent: number;      // positive integer ≥ 1
}

interface HttpRequestOptions {
  maxConcurrentRequests: number;   // positive integer ≥ 1
  defaultInit?: RequestInit;       // applied to every request
}

interface LimiterStats {
  readonly maxConcurrent: number;
  readonly activeCount: number;
  readonly queueLength: number;
}
```

---

## Project structure

```
src/
  types.ts                  — all shared TypeScript interfaces and type aliases
  concurrency-limiter.ts    — core scheduler: FIFO queue, #drain / #run slot recycling
  http-request-limiter.ts   — fetch wrapper with header merging, delegates scheduling
  index.ts                  — public barrel export
tests/
  concurrency-limiter.test.ts   — 28 tests: ceiling, FIFO, slot recycling, errors, stats, types
  http-request-limiter.test.ts  — 14 tests: fetch mocking, header merging, concurrency
  helpers/
    controlled-task.ts          — makeControlledTask<T>: deterministic async test utility
examples/
  demo-concurrency-limiter.ts   — runnable local demo (npm run example:limiter)
  demo-http-limiter.ts          — runnable HTTP demo (npm run example:http)
```

---

## Test coverage

```
File                     | % Stmts | % Branch | % Funcs | % Lines
-------------------------|---------|----------|---------|--------
All files                |   100   |   100    |   100   |   100
concurrency-limiter.ts   |   100   |   100    |   100   |   100
http-request-limiter.ts  |   100   |   100    |   100   |   100
index.ts                 |   100   |   100    |   100   |   100
```

Run `npm run test:coverage` to reproduce.

---

## Requirements audit

Audited against 5 production requirements:

| # | Requirement | Status | Evidence |
|---|---|---|---|
| R1 | Unlimited outgoing HTTP requests can be enqueued | ✅ PASS | `#queue` is an unbounded `Array` — no size cap (`concurrency-limiter.ts:92`) |
| R2 | Concurrent requests capped at a configurable maximum | ✅ PASS | `while (activeCount < maxConcurrent)` in `#drain` (`concurrency-limiter.ts:205`); value set at construction |
| R3 | Next queued request starts immediately on completion (success or error) | ✅ PASS | `.finally(() => { activeCount--; #drain() })` fires on both paths (`concurrency-limiter.ts:240-245`) |
| R4 | Requests processed in FIFO order | ✅ PASS | `Array.push` on enqueue + `Array.shift` on drain = strict FIFO; proven by test *"processes tasks in enqueue order with maxConcurrent=1"* |
| R5 | Generic type-safe wrapper for any async operation | ✅ PASS | `enqueue<T>(task: AsyncTask<T>): Promise<T>` — no HTTP coupling in core; `HttpRequestLimiter` is an optional domain adapter |

**Verdict: all 5 requirements satisfied.**

---

## Commands

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:watch` | Compile in watch mode |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests and print coverage report |
| `npm run example:limiter` | Run the local concurrency demo |
| `npm run example:http` | Run the HTTP request demo |

---

## Design notes

- **No `async/await` in the scheduler hot path** — `#run` uses raw `.then/.catch/.finally` to avoid the extra microtask and implicit Promise allocation that `async` functions introduce. This matters at high task throughput.
- **`QueueItem<unknown>` internally, `enqueue<T>` externally** — the queue is heterogeneous (each task can have a different `T`). Type safety is preserved through the `resolve`/`reject` closures captured inside each `new Promise<T>` at the enqueue boundary.
- **Single slot-release site** — `#activeCount` is only ever decremented in `.finally`, making it impossible for a slot to leak regardless of task outcome.
- **Slot recycling** — `#drain` is called in two places: on `enqueue` (to claim a free slot immediately if one exists) and in `.finally` (to recycle the slot the moment a task finishes). This keeps the limiter running at full capacity with no gaps.
- **Delegation over inheritance** — `HttpRequestLimiter` holds a `ConcurrencyLimiter` instance and delegates all scheduling to it. Zero queue logic is duplicated.
