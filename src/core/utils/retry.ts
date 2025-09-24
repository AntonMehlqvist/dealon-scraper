/**
 * Reusable retry logic utility
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  backoffMultiplier?: number;
  jitterMs?: number;
  retryCondition?: (error: Error) => boolean;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public originalError: Error,
    public attempt: number,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

/**
 * Executes an operation with retry logic
 * @param operation - The operation to retry
 * @param options - Retry configuration
 * @returns Promise that resolves with the operation result
 * @throws RetryError if all retries are exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    baseDelayMs,
    backoffMultiplier = 2,
    jitterMs = 250,
    retryCondition = () => true,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry this error
      if (!retryCondition(lastError)) {
        throw lastError;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw new RetryError(
          `Operation failed after ${maxRetries + 1} attempts`,
          lastError,
          attempt + 1,
        );
      }

      // Calculate delay with exponential backoff and jitter
      const jitter = Math.floor(Math.random() * jitterMs);
      const delay = baseDelayMs * Math.pow(backoffMultiplier, attempt) + jitter;

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new RetryError(
    `Operation failed after ${maxRetries + 1} attempts`,
    lastError!,
    maxRetries + 1,
  );
}

/**
 * Creates a retry function with predefined options
 * @param options - Default retry options
 * @returns A retry function with the given options
 */
export function createRetryFunction(options: RetryOptions) {
  return <T>(operation: () => Promise<T>) => withRetry(operation, options);
}

/**
 * Default retry options for HTTP requests
 */
export const HTTP_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 800,
  backoffMultiplier: 2,
  jitterMs: 250,
  retryCondition: (error) => {
    // Retry on network errors, timeouts, and 5xx errors
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("http 5")
    );
  },
};

/**
 * Default retry options for database operations
 */
export const DB_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 100,
  backoffMultiplier: 2,
  jitterMs: 50,
  retryCondition: (error) => {
    // Retry on database locks and temporary failures
    const message = error.message.toLowerCase();
    return (
      message.includes("locked") ||
      message.includes("busy") ||
      message.includes("temporary")
    );
  },
};

/**
 * Default retry options for browser operations
 */
export const BROWSER_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 1000,
  backoffMultiplier: 1.5,
  jitterMs: 500,
  retryCondition: (error) => {
    // Retry on navigation timeouts and page load errors
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("navigation") ||
      message.includes("page load")
    );
  },
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
