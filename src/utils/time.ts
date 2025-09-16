/**
 * Resolves after the specified duration.
 * @param durationMs - Number of milliseconds to wait.
 */
export function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}

