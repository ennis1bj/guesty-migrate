import axios from 'axios';
import { logger } from '../utils/logger';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface RateStrategyRule {
  type: 'season' | 'holiday' | 'occupancy' | 'dayOfWeek' | 'gapFill' | string;
  name?: string;
  dateRanges?: Array<{ startDate: string; endDate: string }>;
  adjustment?: { type: 'percent' | 'fixed'; value: number };
  minNights?: number;
  conditions?: Record<string, unknown>;
}

export interface RateStrategy {
  id: string;
  name: string;
  description?: string;
  rules: RateStrategyRule[];
  assignedListingIds: string[];
}

// ── Internal token cache ──────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

const AUTH_URL = 'https://open-api.guesty.com/oauth2/token';
const API_BASE = 'https://open-api.guesty.com/v1';

const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  logger.info('Fetching Guesty Open API access token');

  const response = await axios.post<{ access_token: string; expires_in?: number }>(
    AUTH_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    }
  );

  const { access_token, expires_in } = response.data;
  if (!access_token) {
    throw new Error('Guesty OAuth response did not include an access_token');
  }

  tokenCache.set(clientId, {
    token: access_token,
    expiresAt: Date.now() + (expires_in ?? 86_400) * 1000,
  });

  return access_token;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches all Rate Strategies from the source Guesty account using the Open API.
 * Authenticates via OAuth2 client credentials and caches the token for 24 hours.
 */
export async function fetchRateStrategies(
  clientId: string,
  clientSecret: string
): Promise<RateStrategy[]> {
  const token = await getAccessToken(clientId, clientSecret);

  const response = await axios.get<unknown>(
    `${API_BASE}/revenue-management/rate-strategies`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30_000,
    }
  );

  const data = response.data as Record<string, unknown>;
  const raw = (data.results ?? data.data ?? data) as unknown[];

  if (!Array.isArray(raw)) {
    logger.warn('fetchRateStrategies: unexpected response shape — returning empty array');
    return [];
  }

  return raw.map((r): RateStrategy => {
    const item = r as Record<string, unknown>;
    return {
      id: (item._id ?? item.id ?? '') as string,
      name: (item.name ?? 'Unnamed Strategy') as string,
      description: item.description as string | undefined,
      rules: Array.isArray(item.rules) ? (item.rules as RateStrategyRule[]) : [],
      assignedListingIds: Array.isArray(item.listingIds)
        ? (item.listingIds as string[])
        : [],
    };
  });
}
