/** Maximum concurrent remote reads permitted for one Agent command execution. */
export const AGENT_REMOTE_READ_CONCURRENCY = 8;

/** Map items with a fixed concurrency ceiling while retaining input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive safe integer.');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Settle tasks with the same ordered result contract as Promise.allSettled. */
export function settleWithConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  return mapWithConcurrency(tasks, concurrency, async (task) => {
    try {
      return { status: 'fulfilled', value: await task() } as const;
    } catch (reason) {
      return { status: 'rejected', reason } as const;
    }
  });
}
