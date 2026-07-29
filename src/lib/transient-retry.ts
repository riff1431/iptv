export type TransientRetryOptions = {
  attempts?: number;
  delayMs?: (retryIndex: number) => number;
  shouldRetry?: (error: unknown) => boolean;
};

/**
 * Retry a short-lived browser/network operation without hiding permanent
 * failures. This is intentionally bounded so route navigation can never hang.
 */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: TransientRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? ((retryIndex) => 120 * 2 ** retryIndex);
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const hasAnotherAttempt = attempt + 1 < attempts;
      if (!hasAnotherAttempt || !shouldRetry(error)) throw error;

      const waitMs = Math.max(0, delayMs(attempt));
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError;
}
