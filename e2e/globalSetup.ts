/**
 * Playwright global setup — starts the Guesty API mock server before any
 * webServer or test runs.  The mock URL is written to process.env so it is
 * inherited by the webServer child process.
 */

import { startGuestyMockServer, MOCK_GUESTY_PORT } from './fixtures/guesty';

export default async function globalSetup() {
  const mock = await startGuestyMockServer(MOCK_GUESTY_PORT);
  process.env.GUESTY_BASE_URL = mock.url;
  process.env.GUESTY_AUTH_URL = mock.url;
  (globalThis as Record<string, unknown>).__guestyMockStop = mock.stop;
}
