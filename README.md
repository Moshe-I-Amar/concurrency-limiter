# concurrency-limiter

Limit how many async tasks or HTTP requests run at once — excess work queues automatically and starts the moment a slot frees up.

## Install

```bash
npm install
```

## Usage

**Generic async tasks:**
```typescript
import { ConcurrencyLimiter } from './src/index';

const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });

const results = await Promise.all(
  items.map(item => limiter.enqueue(() => processItem(item)))
);
```

**HTTP requests:**
```typescript
import { HttpRequestLimiter } from './src/index';

const api = new HttpRequestLimiter({
  maxConcurrentRequests: 5,
  defaultInit: { headers: { 'Authorization': 'Bearer token' } },
});

const responses = await Promise.all(
  urls.map(url => api.request(url))
);
```

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm test` | Run the test suite |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run example:limiter` | Run local concurrency demo |
| `npm run example:http` | Run HTTP requests demo |

## Requirements satisfied

- Unlimited tasks can be enqueued with no size cap
- Concurrent execution is capped at a configurable maximum
- Next queued task starts immediately when any task finishes, success or error
- Tasks are processed in FIFO order
- `enqueue<T>(task: () => Promise<T>): Promise<T>` works for any async operation
