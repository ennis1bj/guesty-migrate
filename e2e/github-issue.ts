/**
 * Logs a GitHub issue to ennis1bj/guesty-migrate using the Replit connector SDK.
 *
 * Falls back to console.warn when the OAuth token is unavailable (CI / no-auth env).
 */

const GITHUB_OWNER = 'ennis1bj';
const GITHUB_REPO  = 'guesty-migrate';

export async function logGitHubIssue(title: string, body: string): Promise<void> {
  try {
    // Dynamic import so the test file works even without @replit/connectors-sdk installed
    const { ReplitConnectors } = await import('@replit/connectors-sdk');
    const connectors = new ReplitConnectors();

    const response = await connectors.proxy(
      'github',
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[E2E] ${title}`,
          body: `${body}\n\n---\n*Logged automatically by the E2E browser journey test suite.*`,
          labels: ['bug', 'e2e'],
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      console.warn(`[github-issue] HTTP ${response.status}: ${text.slice(0, 200)}`);
      return;
    }

    const issue = await response.json() as { html_url?: string; number?: number };
    console.info(`[github-issue] Created #${issue.number}: ${issue.html_url}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Graceful fallback — never throw
    console.warn(`[github-issue] Could not create issue "${title}": ${msg}`);
    console.warn(`[github-issue] Issue body:\n${body}`);
  }
}
