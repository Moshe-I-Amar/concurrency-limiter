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
  readonly settled: boolean;
} {
  let resolveInner!: (value: T) => void;
  let rejectInner!: (reason: unknown) => void;
  let isSettled = false;

  const innerPromise = new Promise<T>((res, rej) => {
    resolveInner = res;
    rejectInner = rej;
  });

  const task = (): Promise<T> => innerPromise;

  const resolve = (value: T): void => {
    isSettled = true;
    resolveInner(value);
  };

  const reject = (reason: unknown): void => {
    isSettled = true;
    rejectInner(reason);
  };

  return {
    task,
    resolve,
    reject,
    get settled(): boolean {
      return isSettled;
    },
  };
}
