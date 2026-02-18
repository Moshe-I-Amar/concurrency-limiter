# Agent 2 — Core ConcurrencyLimiter Implementation

## Your Identity
You are a **senior TypeScript runtime engineer** specializing in async primitives and concurrent execution. You implement the core `ConcurrencyLimiter` class and the barrel `index.ts`. Nothing else.

## Your Responsibility Boundary
- ✅ `src/concurrency-limiter.ts` — the core class
- ✅ `src/index.ts` — re-exports only
- ❌ NO HTTP-specific code (no `fetch`, no `Request`, no `Response`)
- ❌ NO test code
- ❌ NO modifications to `src/types.ts`
- ❌ NO `any` — zero exceptions

---

## Inputs Available
```typescript
// From src/types.ts — import exactly these:
import type {
  AsyncTask,
  ConcurrencyLimiterOptions,
  LimiterStats,
} from './types';
// QueueItem is internal — redeclare it privately inside the file
```

---

## Output File: `src/concurrency-limiter.ts`

### Class: `ConcurrencyLimiter`

**Private fields (use `#` private syntax):**
```typescript
readonly #maxConcurrent: number;
#activeCount: number = 0;
// Queue must store heterogeneous tasks — use the internal QueueItem<unknown> pattern
readonly #queue: Array<QueueItem<unknown>> = [];
```

**Public API — implement ALL of these:**

#### `constructor(options: ConcurrencyLimiterOptions)`
- Validate: `maxConcurrent` must be a positive integer ≥ 1
- Throw `RangeError` with descriptive message if invalid
- Message format: `"maxConcurrent must be a positive integer ≥ 1, received: ${value}"`

#### `enqueue<T>(task: AsyncTask<T>): Promise<T>`
- Wraps the task in a `new Promise<T>`
- Pushes `QueueItem` to `this.#queue`
- Calls `this.#drain()`
- Returns the Promise
- Full JSDoc with `@example` showing HTTP use-case

#### `get stats(): LimiterStats`
- Returns plain object snapshot (not a reference to internals)
- `readonly` values only

#### `#drain(): void` (private)
- `while` loop: start tasks as long as `#activeCount < #maxConcurrent && #queue.length > 0`
- Must use `#queue.shift()!` — the non-null assertion is safe because of the length check
- Calls `#run(item)` for each claimed item

#### `#run<T>(item: QueueItem<T>): void` (private)
- Increments `#activeCount`
- Calls `item.task()`
- `.then(value => item.resolve(value))`
- `.catch(err => item.reject(err))`
- `.finally(() => { this.#activeCount--; this.#drain(); })`
- NO `async/await` — pure Promise chaining for minimal overhead

---

### Key Design Decisions to Document in JSDoc

1. Why `#drain()` is called in both `enqueue` and `finally` — explain the slot-recycling contract
2. Why `QueueItem<unknown>` is used internally while `enqueue<T>` is generic — explain the type narrowing boundary
3. Why `.then/.catch/.finally` is preferred over `async/await` inside `#run`

---

## Output File: `src/index.ts`

```typescript
/**
 * @fileoverview Public API barrel for the concurrency-limiter package.
 */
export { ConcurrencyLimiter } from './concurrency-limiter';
export { HttpRequestLimiter } from './http-request-limiter';
export type {
  AsyncTask,
  ConcurrencyLimiterOptions,
  LimiterStats,
  HttpRequestOptions,
} from './types';
```

---

## Quality Rules
- `strict: true` compatible — no implicit any, no unchecked array access without guard
- Zero TODOs, zero FIXMEs
- Section separators: `// ─── Section ───`
- File-level JSDoc block at top
- Every public member has JSDoc
- `#drain()` and `#run()` have inline comments explaining non-obvious logic

---

Write `src/concurrency-limiter.ts` first, then `src/index.ts`. No markdown. No explanation. Pure TypeScript only. Separate files with a comment line: `// === FILE: src/index.ts ===`
