export interface PollingStreamOptions {
  readonly intervalSeconds: number;
  poll(): Promise<void>;
}

/** Run an interruptible polling loop and release the SIGINT listener on every exit path. */
export async function pollUntilInterrupted(
  options: PollingStreamOptions,
): Promise<void> {
  let stopped = false;
  let interruptWait: (() => void) | undefined;
  const onSigint = (): void => {
    stopped = true;
    interruptWait?.();
  };
  process.once('SIGINT', onSigint);

  try {
    while (!stopped) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          interruptWait = undefined;
          resolve();
        }, options.intervalSeconds * 1000);
        interruptWait = () => {
          clearTimeout(timer);
          interruptWait = undefined;
          resolve();
        };
      });
      if (!stopped) {
        await options.poll();
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}
