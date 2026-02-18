# concurrency-limiter

A production-grade TypeScript library for controlling the maximum number of async tasks or HTTP requests running simultaneously. Built with strict TypeScript, zero dependencies, and 100% test coverage.

## How it works

When you enqueue more tasks than the configured limit, excess tasks are held in a FIFO queue and started automatically as running slots free up — no polling, no timers, just Promise chaining.

```
enqueue(task) → slot free? → run immediately
                            → no slot? → queue → wait for a slot to free → run
```

## Installation

```bash
npm install
```

## Commands

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:watch` | Compile in watch mode |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests and print coverage report |

## Examples

After cloning and running `npm install`, you can see the limiter in action:

```bash
# Watch 8 tasks run in batches of 3
npm run example:limiter

# Fetch 6 API posts with max 2 requests at a time (requires internet)
npm run example:http
```

**`example:limiter` output:**
```
ConcurrencyLimiter demo
  tasks: 8  |  maxConcurrent: 3  |  each task: 500ms

  [task 1] started  | active: 1 | queued: 0
  [task 2] started  | active: 2 | queued: 0
  [task 3] started  | active: 3 | queued: 0
  [task 1] finished
  [task 4] started  | active: 3 | queued: 0
  ...

All done in 1504ms
Expected ~1500ms (3 batches × 500ms)
Without limiter it would be ~500ms (all parallel)
```

---

## Usage

### ConcurrencyLimiter

Limit how many async tasks run at once — works with any `() => Promise<T>`.

```typescript
import { ConcurrencyLimiter } from './src/index';

const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });

// Enqueue 10 tasks — only 3 run at a time, the rest queue automatically
const results = await Promise.all(
  urls.map(url => limiter.enqueue(() => fetch(url).then(r => r.json())))
);

// Inspect runtime state
const { activeCount, queueLength } = limiter.stats;
```

### HttpRequestLimiter

A thin wrapper around `fetch` that applies concurrency limiting to outbound HTTP requests. Supports default headers merged with per-request headers.

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

// At most 5 requests fly simultaneously
const responses = await Promise.all(
  userIds.map(id => api.request(`https://api.example.com/users/${id}`))
);

// Per-request headers are merged on top of defaultInit headers
const response = await api.request('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }, // merged, not replaced
  body: JSON.stringify({ name: 'widget' }),
});
```

### Header merging

`defaultInit.headers` and per-request `headers` are merged key-by-key. Per-request values win on conflicts; unrelated default headers are preserved.

```typescript
// defaultInit.headers:  { Authorization: 'Bearer token', Accept: 'application/json' }
// per-request headers:  { 'Content-Type': 'application/json' }
// merged result:        { Authorization: 'Bearer token', Accept: 'application/json', 'Content-Type': 'application/json' }
```

## API

### `ConcurrencyLimiter`

```typescript
new ConcurrencyLimiter(options: ConcurrencyLimiterOptions)
```

| Member | Type | Description |
|---|---|---|
| `enqueue(task)` | `(task: AsyncTask<T>) => Promise<T>` | Submit a task; returns a Promise that settles when the task completes |
| `stats` | `LimiterStats` | Read-only snapshot: `maxConcurrent`, `activeCount`, `queueLength` |

Throws `RangeError` if `maxConcurrent` is not a positive integer ≥ 1.

### `HttpRequestLimiter`

```typescript
new HttpRequestLimiter(options: HttpRequestOptions)
```

| Member | Type | Description |
|---|---|---|
| `request(input, init?)` | `Promise<Response>` | Enqueue a fetch call; same signature as `fetch` |
| `stats` | `LimiterStats` | Delegates to the underlying `ConcurrencyLimiter` |
| `limiter` | `ConcurrencyLimiter` | Access the underlying limiter directly |

## Project structure

```
src/
  types.ts                  — shared TypeScript interfaces and type aliases
  concurrency-limiter.ts    — core scheduler (#drain / #run slot recycling)
  http-request-limiter.ts   — fetch wrapper with init merging
  index.ts                  — public barrel export
tests/
  concurrency-limiter.test.ts       — 28 tests (ceiling, FIFO, slot recycling, errors, stats)
  http-request-limiter.test.ts      — 14 tests (fetch mocking, header merging, concurrency)
  helpers/
    controlled-task.ts      — makeControlledTask<T>: deterministic async test utility
```

## Test coverage

```
File                     | % Stmts | % Branch | % Funcs | % Lines
-------------------------|---------|----------|---------|--------
concurrency-limiter.ts   |   100   |   100    |   100   |   100
http-request-limiter.ts  |   100   |   100    |   100   |   100
index.ts                 |   100   |   100    |   100   |   100
```

## Design notes

- **No `async/await` in the scheduler hot path** — `#run` uses raw `.then/.catch/.finally` to avoid the extra microtask and implicit Promise allocation that `async` functions introduce.
- **`QueueItem<unknown>` internally, `enqueue<T>` externally** — the queue is heterogeneous; type safety is preserved through the `resolve`/`reject` closures captured inside each `new Promise<T>`.
- **Slot recycling** — `#drain` is called both on `enqueue` (to claim a free slot immediately) and in `.finally` (to recycle the slot the moment a task completes), keeping the limiter at full capacity whenever work is available.
