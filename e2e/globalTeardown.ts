/**
 * Playwright global teardown — shuts down the Guesty API mock server.
 */

export default async function globalTeardown() {
  const stop = (globalThis as Record<string, unknown>).__guestyMockStop as (() => Promise<void>) | undefined;
  if (typeof stop === 'function') {
    await stop();
  }
}
