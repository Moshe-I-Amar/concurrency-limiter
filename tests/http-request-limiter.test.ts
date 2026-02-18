import { ConcurrencyLimiter, HttpRequestLimiter } from '../src/index';
import { makeControlledTask } from './helpers/controlled-task';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockFetch = jest.fn<Promise<Response>, [string | URL | Request, RequestInit?]>();
global.fetch = mockFetch as typeof fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockResponse(status = 200): Response {
  return new Response(null, { status });
}

/** Flush microtask queue for deeply-chained promise handlers. */
async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('HttpRequestLimiter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('throws RangeError for maxConcurrentRequests=0 (propagated from ConcurrencyLimiter)', () => {
      expect(
        () => new HttpRequestLimiter({ maxConcurrentRequests: 0 }),
      ).toThrow(RangeError);
    });

    it('initializes with valid options without throwing', () => {
      expect(
        () => new HttpRequestLimiter({ maxConcurrentRequests: 5 }),
      ).not.toThrow();
    });
  });

  // ── request() ────────────────────────────────────────────────────────────

  describe('request()', () => {
    it('calls fetch with the provided URL', async () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 1 });
      mockFetch.mockResolvedValue(makeMockResponse());

      await http.request('https://example.com/api');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.anything(),
      );
    });

    it('calls fetch with merged init headers (defaultInit + per-request init)', async () => {
      const http = new HttpRequestLimiter({
        maxConcurrentRequests: 1,
        defaultInit: { headers: { 'Authorization': 'Bearer token' } },
      });
      mockFetch.mockResolvedValue(makeMockResponse());

      await http.request('https://example.com/api', {
        headers: { 'X-Request-Id': '123' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token',
            'X-Request-Id': '123',
          }),
        }),
      );
    });

    it('per-request headers override defaultInit headers for same key', async () => {
      const http = new HttpRequestLimiter({
        maxConcurrentRequests: 1,
        defaultInit: { headers: { 'Accept': 'text/plain' } },
      });
      mockFetch.mockResolvedValue(makeMockResponse());

      await http.request('https://example.com/api', {
        headers: { 'Accept': 'application/json' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
          }),
        }),
      );
    });

    it('per-request headers do not delete unrelated defaultInit headers', async () => {
      const http = new HttpRequestLimiter({
        maxConcurrentRequests: 1,
        defaultInit: {
          headers: {
            'Authorization': 'Bearer secret',
            'Accept': 'application/json',
          },
        },
      });
      mockFetch.mockResolvedValue(makeMockResponse());

      await http.request('https://example.com/api', {
        headers: { 'X-Custom': 'value' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer secret',
            'Accept': 'application/json',
            'X-Custom': 'value',
          }),
        }),
      );
    });

    it('returns the Response from fetch', async () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 1 });
      const expectedResponse = makeMockResponse(201);
      mockFetch.mockResolvedValue(expectedResponse);

      const result = await http.request('https://example.com/api');

      expect(result).toBe(expectedResponse);
    });

    it('rejects when fetch rejects (network error propagation)', async () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 1 });
      const networkError = new TypeError('Failed to fetch');
      mockFetch.mockRejectedValue(networkError);

      await expect(http.request('https://example.com/api')).rejects.toThrow(
        'Failed to fetch',
      );
    });

    it('limits concurrent fetch calls to maxConcurrentRequests', async () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 2 });

      const controls = [
        makeControlledTask<Response>(),
        makeControlledTask<Response>(),
        makeControlledTask<Response>(),
      ];

      let fetchCallCount = 0;
      mockFetch.mockImplementation((): Promise<Response> => {
        const idx = fetchCallCount;
        fetchCallCount++;
        const ctrl = controls[idx];
        if (ctrl === undefined) {
          return Promise.reject(new Error('unexpected fetch call'));
        }
        return ctrl.task();
      });

      const promises = [
        http.request('https://example.com/1'),
        http.request('https://example.com/2'),
        http.request('https://example.com/3'),
      ];

      await flushMicrotasks();

      // Only 2 concurrent fetch calls should have been initiated
      expect(fetchCallCount).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Resolve the first, which should allow the third to start
      controls[0]!.resolve(makeMockResponse(200));
      await flushMicrotasks();

      expect(fetchCallCount).toBe(3);

      controls[1]!.resolve(makeMockResponse(200));
      controls[2]!.resolve(makeMockResponse(200));
      await Promise.all(promises);
    });
  });

  // ── stats ────────────────────────────────────────────────────────────────

  describe('stats', () => {
    it('delegates to underlying ConcurrencyLimiter stats', async () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 3 });
      const c = makeControlledTask<Response>();

      mockFetch.mockImplementation(() => c.task());

      http.request('https://example.com/api');
      await flushMicrotasks();

      const { activeCount, queueLength, maxConcurrent } = http.stats;
      expect(activeCount).toBe(1);
      expect(queueLength).toBe(0);
      expect(maxConcurrent).toBe(3);

      c.resolve(makeMockResponse());
      await flushMicrotasks();
    });

    it('limiter getter exposes the underlying ConcurrencyLimiter instance', () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 5 });
      expect(http.limiter).toBeInstanceOf(ConcurrencyLimiter);
    });
  });

  // ── header merging ───────────────────────────────────────────────────────

  describe('header merging', () => {
    it('uses empty headers when neither defaultInit nor init provide headers', async () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 1 });
      mockFetch.mockResolvedValue(makeMockResponse());

      await http.request('https://example.com/api');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: {},
        }),
      );
    });

    it('uses defaultInit headers when init provides none', async () => {
      const http = new HttpRequestLimiter({
        maxConcurrentRequests: 1,
        defaultInit: { headers: { 'X-Default': 'default-value' } },
      });
      mockFetch.mockResolvedValue(makeMockResponse());

      await http.request('https://example.com/api');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Default': 'default-value',
          }),
        }),
      );
    });

    it('uses init headers when defaultInit provides none', async () => {
      const http = new HttpRequestLimiter({ maxConcurrentRequests: 1 });
      mockFetch.mockResolvedValue(makeMockResponse());

      await http.request('https://example.com/api', {
        headers: { 'X-Custom': 'custom-value' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom': 'custom-value',
          }),
        }),
      );
    });
  });
});
