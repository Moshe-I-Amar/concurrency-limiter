/**
 * @fileoverview HTTP request wrapper with concurrency limiting.
 *
 * `HttpRequestLimiter` is a thin domain adapter that composes `ConcurrencyLimiter`
 * with the browser/Node.js Fetch API. It enforces a hard cap on the number of
 * simultaneous in-flight HTTP requests without implementing its own queue or
 * scheduling logic itself — all concurrency control is delegated entirely to
 * `ConcurrencyLimiter`.
 *
 * Design note: this class contains zero scheduling logic. Its sole
 * responsibilities are (1) merging `RequestInit` objects, (2) wrapping each
 * `fetch` call into the task signature expected by `ConcurrencyLimiter`, and
 * (3) exposing observability and advanced-access surface through typed getters.
 * Any change to queueing behaviour belongs in `ConcurrencyLimiter`, not here.
 */

import { ConcurrencyLimiter } from './concurrency-limiter';
import type { HttpRequestOptions, LimiterStats } from './types';

// ─── HttpRequestLimiter ───────────────────────────────────────────────────────

/**
 * Rate-limits outbound HTTP requests by delegating to a `ConcurrencyLimiter`.
 *
 * Construct once per logical rate-limit boundary (e.g. per third-party API
 * host) and share the instance across callers so they all compete for the same
 * concurrency slots.
 *
 * @example
 * ```typescript
 * const api = new HttpRequestLimiter({
 *   maxConcurrentRequests: 5,
 *   defaultInit: {
 *     headers: { 'Authorization': 'Bearer token', 'Accept': 'application/json' },
 *   },
 * });
 *
 * // At most 5 requests fly simultaneously; the rest queue automatically.
 * const responses = await Promise.all(
 *   userIds.map(id => api.request(`https://api.example.com/users/${id}`))
 * );
 * ```
 */
export class HttpRequestLimiter {
  // ─── Private Fields ──────────────────────────────────────────────────────────

  /**
   * The underlying concurrency scheduler. All queuing and slot-management
   * behaviour lives here; this class never touches it directly.
   */
  readonly #limiter: ConcurrencyLimiter;

  /**
   * Default `RequestInit` options applied to every request before per-request
   * overrides are merged on top.
   */
  readonly #defaultInit: RequestInit;

  // ─── Constructor ─────────────────────────────────────────────────────────────

  /**
   * Creates a new `HttpRequestLimiter`.
   *
   * `maxConcurrentRequests` must be a positive integer ≥ 1. Validation is
   * delegated to `ConcurrencyLimiter`, which throws a `RangeError` for invalid
   * values so that both classes enforce the same constraint from a single
   * source of truth.
   *
   * @param options - Configuration for the limiter and optional default fetch init.
   * @throws {RangeError} When `maxConcurrentRequests` is not a positive integer ≥ 1.
   *
   * @example
   * ```typescript
   * const limiter = new HttpRequestLimiter({
   *   maxConcurrentRequests: 10,
   *   defaultInit: { headers: { 'X-Api-Key': 'secret' } },
   * });
   * ```
   */
  constructor(options: HttpRequestOptions) {
    // Validation is intentionally delegated to ConcurrencyLimiter so that the
    // RangeError message, boundary check, and integer check remain in one place.
    this.#limiter = new ConcurrencyLimiter({
      maxConcurrent: options.maxConcurrentRequests,
    });

    this.#defaultInit = options.defaultInit ?? {};
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Submits an HTTP request to be executed under the concurrency limit.
   *
   * The call is transparent to the caller: the returned `Promise<Response>`
   * settles with the same value or rejection as the underlying `fetch` call.
   * If all concurrency slots are occupied the request is queued in FIFO order
   * and dispatched automatically once a slot becomes free.
   *
   * **Init merging:** `#defaultInit` is applied first; `init` is spread on top
   * so that per-request values win on conflicts. `headers` require a dedicated
   * merge step because a plain spread (`{ ...defaultInit, ...init }`) would
   * overwrite the entire `headers` object from `#defaultInit` with the one
   * from `init`, silently dropping the default headers that the per-request
   * `init` does not repeat. By spreading each `headers` object individually
   * into a new plain object, both sets of headers are preserved and the
   * per-request headers still win on key conflicts.
   *
   * @param input - The resource to fetch. Identical to the first argument of
   *   the global `fetch` function: a URL string, a `URL` object, or a
   *   `Request` object.
   * @param init - Optional per-request fetch options. Merged shallowly on top
   *   of `#defaultInit`; per-request values take precedence on conflicts.
   *   `headers` are merged key-by-key rather than replaced wholesale.
   * @returns A `Promise` that resolves to the `Response` when the request has
   *   been dequeued and the network call completes successfully.
   * @throws Propagates network-level errors thrown by `fetch` (e.g.
   *   `TypeError` for DNS failure or CORS rejection). HTTP error status codes
   *   (4xx, 5xx) do NOT cause rejection — callers must inspect `Response.ok`.
   *
   * @example
   * ```typescript
   * const api = new HttpRequestLimiter({
   *   maxConcurrentRequests: 3,
   *   defaultInit: { headers: { 'Accept': 'application/json' } },
   * });
   *
   * // Per-request header is merged; 'Accept' from defaultInit is preserved.
   * const response = await api.request('https://api.example.com/items', {
   *   method: 'POST',
   *   headers: { 'Content-Type': 'application/json' },
   *   body: JSON.stringify({ name: 'widget' }),
   * });
   *
   * if (!response.ok) {
   *   throw new Error(`HTTP ${response.status}`);
   * }
   * ```
   */
  request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    // Headers need their own merge pass. A top-level spread alone would
    // discard all default headers whenever `init` supplies its own headers of
    // own, because the spread replaces the entire object reference rather than
    // unioning the individual key-value pairs.
    const mergedInit: RequestInit = {
      ...this.#defaultInit,
      ...init,
      headers: {
        ...(this.#defaultInit.headers as Record<string, string> | undefined),
        ...(init?.headers as Record<string, string> | undefined),
      },
    };

    return this.#limiter.enqueue(() => fetch(input, mergedInit));
  }

  // ─── Observability ───────────────────────────────────────────────────────────

  /**
   * Returns a read-only snapshot of the underlying limiter's runtime state.
   *
   * Useful as an observability hook: log or expose these counters to monitor
   * queue depth and active request count without coupling callers to the
   * internal `ConcurrencyLimiter` interface.
   *
   * Each access produces a new plain-object snapshot; mutating the returned
   * object has no effect on the limiter.
   *
   * @returns A `LimiterStats` snapshot with `maxConcurrent`, `activeCount`,
   *   and `queueLength` fields.
   *
   * @example
   * ```typescript
   * const { activeCount, queueLength } = api.stats;
   * metrics.gauge('http.active', activeCount);
   * metrics.gauge('http.queued', queueLength);
   * ```
   */
  get stats(): LimiterStats {
    return this.#limiter.stats;
  }

  // ─── Advanced Access ─────────────────────────────────────────────────────────

  /**
   * Exposes the underlying `ConcurrencyLimiter` for advanced use cases.
   *
   * Allows callers to enqueue non-HTTP tasks on the same limiter instance,
   * sharing the concurrency budget with HTTP requests — for example, mixing
   * fetch calls with CPU-bound work that should count against the same slot
   * limit, or attaching a second domain-specific wrapper around the same
   * scheduler.
   *
   * @returns The `ConcurrencyLimiter` instance owned by this wrapper.
   *
   * @example
   * ```typescript
   * // Enqueue a non-HTTP task that shares the same concurrency budget.
   * const result = await api.limiter.enqueue(() => computeHeavyTask());
   * ```
   */
  get limiter(): ConcurrencyLimiter {
    return this.#limiter;
  }
}
