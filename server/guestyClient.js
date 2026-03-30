const axios = require('axios');
const FormData = require('form-data');
const { pool } = require('./db');
const { encrypt, decrypt } = require('./encryption');
const { logger } = require('./logger');

const BASE_URL = (process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com') + '/v1';
const AUTH_URL = (process.env.GUESTY_AUTH_URL || 'https://open-api.guesty.com') + '/oauth2/token';

/**
 * Simple promise-based semaphore.  Limits the number of concurrent tasks
 * to `max`; additional callers queue until a slot is released.
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }

  acquire() {
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next(); // hand the slot to the next waiter
    } else {
      this.count--;
    }
  }
}

// Columns required by the tasks endpoint (columns param is mandatory)
const TASK_COLUMNS = '_id title description status listingId dueDate type priority notes plannedStartDate plannedEndDate parentTaskId';

class GuestyClient {
  constructor({ clientId, clientSecret }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.maxRetries = 3;
    // Limit concurrent requests to the Guesty API to avoid triggering 429s
    // when multiple operations (preflight counts, parallel page fetches, etc.)
    // are in-flight simultaneously.
    this.semaphore = new Semaphore(5);
    // Cached account ID — resolved lazily via getAccountId()
    this._accountId = null;
  }

  async getAccountId() {
    if (this._accountId) return this._accountId;
    const data = await this.request('GET', '/accounts/me');
    this._accountId = data._id;
    if (!this._accountId) throw new Error('GET /accounts/me did not return an _id');
    return this._accountId;
  }

  async getAccessToken() {
    // Check cache first
    try {
      const cached = await pool.query(
        'SELECT access_token, expires_at FROM token_cache WHERE client_id = $1',
        [this.clientId]
      );

      if (cached.rows.length > 0) {
        const { access_token, expires_at } = cached.rows[0];
        if (new Date(expires_at) > new Date(Date.now() + 60000)) {
          try { return decrypt(access_token); } catch { return access_token; }
        }
      }
    } catch (cacheErr) {
      // Cache lookup failed — continue to fetch a fresh token
    }

    // Fetch new token
    let response;
    try {
      response = await axios.post(AUTH_URL, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
    } catch (authErr) {
      const status = authErr.response?.status;
      const msg = authErr.response?.data?.error || authErr.message;
      throw new Error(`Guesty OAuth token request failed (${status || 'network error'}): ${msg}`);
    }

    const { access_token, expires_in } = response.data;
    if (!access_token) {
      throw new Error('Guesty OAuth response did not include an access_token');
    }
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    // Upsert cache — encrypt token at rest
    try {
      await pool.query(
        `INSERT INTO token_cache (client_id, access_token, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (client_id) DO UPDATE SET access_token = $2, expires_at = $3`,
        [this.clientId, encrypt(access_token), expiresAt]
      );
    } catch (cacheWriteErr) {
      // Non-fatal: token is still valid even if cache write fails
    }

    return access_token;
  }

  async request(method, path, data = null, retries = 0) {
    const token = await this.getAccessToken();
    await this.semaphore.acquire();

    // retryAfterMs is set when a 429 is caught so we can wait AFTER releasing
    // the semaphore slot — avoiding blocking other requests during the wait.
    let retryAfterMs = null;
    try {
      const config = {
        method,
        url: `${BASE_URL}${path}`,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      };
      if (data) config.data = data;
      const response = await axios(config);
      return response.data;
    } catch (err) {
      if (err.response && err.response.status === 429 && retries < this.maxRetries) {
        retryAfterMs = parseInt(err.response.headers['retry-after'] || '1', 10) * 1000;
      } else {
        throw err;
      }
    } finally {
      this.semaphore.release(); // always free the slot before any wait
    }

    // If we reach here a 429 was caught — wait with the slot free, then retry.
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return this.request(method, path, data, retries + 1);
  }

  async getAllPaginated(path, key) {
    const limit = 100;
    // If path already contains query params (e.g. ?columns=...), append with &
    const sep = path.includes('?') ? '&' : '?';

    // Fetch first page — it tells us both the first batch of results and,
    // when the API includes a count/total, the total number of records so we
    // can pre-compute all remaining page offsets and fetch them in parallel.
    const firstData = await this.request('GET', `${path}${sep}skip=0&limit=${limit}`);
    const firstResults = firstData.results || firstData[key] || firstData;

    if (!Array.isArray(firstResults) || firstResults.length === 0) return [];
    if (firstResults.length < limit) return firstResults; // single-page result

    const total =
      typeof firstData.count === 'number' ? firstData.count :
      typeof firstData.total === 'number' ? firstData.total :
      null;

    if (total !== null && total > limit) {
      // Pre-compute all remaining page offsets then fetch in parallel batches
      // of 5 to stay within Guesty's rate limits.
      const offsets = [];
      for (let skip = limit; skip < total; skip += limit) {
        offsets.push(skip);
      }

      const CONCURRENCY = 5;
      const remaining = [];
      for (let i = 0; i < offsets.length; i += CONCURRENCY) {
        const batch = offsets.slice(i, i + CONCURRENCY);
        const pages = await Promise.all(
          batch.map((skip) =>
            this.request('GET', `${path}${sep}skip=${skip}&limit=${limit}`)
              .then((data) => data.results || data[key] || data)
          )
        );
        for (const page of pages) {
          if (Array.isArray(page)) remaining.push(...page);
        }
      }

      return [...firstResults, ...remaining];
    }

    // No total count in the response — fall back to sequential pagination.
    const items = [...firstResults];
    let skip = limit;
    while (true) {
      const data = await this.request('GET', `${path}${sep}skip=${skip}&limit=${limit}`);
      const results = data.results || data[key] || data;
      if (!Array.isArray(results) || results.length === 0) break;
      items.push(...results);
      if (results.length < limit) break;
      skip += limit;
    }
    return items;
  }

  async getAllCustomFields() {
    const id = await this.getAccountId();
    return this.getAllPaginated(`/accounts/${id}/custom-fields`, 'results');
  }

  async createCustomField(data) {
    const id = await this.getAccountId();
    return this.request('POST', `/accounts/${id}/custom-fields`, data);
  }

  async getAllFees() {
    // Guesty /additional-fees/account response shape is not fully documented;
    // getAllPaginated tries .results first then falls back to the raw response,
    // which covers { results: [...] } and plain-array responses. If the real
    // API uses a different root key (e.g. 'fees'), adjust the key below.
    return this.getAllPaginated('/additional-fees/account', 'results');
  }

  async createFee(data) {
    return this.request('POST', '/additional-fees/account', data);
  }

  async getAllSavedReplies() {
    return this.getAllPaginated('/saved-replies', 'results');
  }

  async createSavedReply(data) {
    return this.request('POST', '/saved-replies', data);
  }

  async getAllListings() {
    return this.getAllPaginated('/listings', 'results');
  }

  async getAllReservations() {
    return this.getAllPaginated('/reservations', 'results');
  }

  async getAllGuests() {
    return this.getAllPaginated('/guests', 'results');
  }

  async getAllOwners() {
    return this.getAllPaginated('/owners', 'results');
  }

  async getAllTasks() {
    return this.getAllPaginated(
      `/tasks-open-api/tasks?columns=${encodeURIComponent(TASK_COLUMNS)}`,
      'results'
    );
  }

  async getCount(path) {
    try {
      const sep = path.includes('?') ? '&' : '?';
      const data = await this.request('GET', `${path}${sep}skip=0&limit=1`);
      if (typeof data.count === 'number') return data.count;
      if (typeof data.total === 'number') return data.total;
      // Fallback: paginate all and count
      const all = await this.getAllPaginated(path, 'results');
      return all.length;
    } catch (err) {
      const status = err.response?.status;
      // 404/400 means the endpoint is not available on this account's plan.
      // Return null so callers can distinguish "unavailable" from "zero records".
      if (status === 404 || status === 400) {
        logger.info('getCount: endpoint unavailable on this plan — returning null', {
          path, status,
        });
        return null;
      }
      logger.warn('getCount failed — returning 0', {
        path,
        status,
        error: err.response?.data?.message || err.message,
      });
      return 0;
    }
  }

  async getCountAndAll(path) {
    const items = await this.getAllPaginated(path, 'results');
    return { items, count: items.length };
  }

  async createListing(data) {
    return this.request('POST', '/listings', data);
  }

  async createReservation(data) {
    return this.request('POST', '/reservations', data);
  }

  async createGuest(data) {
    return this.request('POST', '/guests', data);
  }

  async findGuestByEmail(email) {
    try {
      const data = await this.request(
        'GET',
        `/guests?filters[email]=${encodeURIComponent(email)}&limit=1`
      );
      const results = data.results || data;
      return Array.isArray(results) ? results[0] : null;
    } catch {
      return null;
    }
  }

  async createOwner(data) {
    return this.request('POST', '/owners', data);
  }

  async createTask(data) {
    return this.request('POST', '/tasks-open-api/tasks', data);
  }

  async uploadListingPhoto(listingId, photoUrl) {
    const token = await this.getAccessToken();

    // Validate the photo URL is an HTTP(S) URL to mitigate SSRF
    let parsedUrl;
    try {
      parsedUrl = new URL(photoUrl);
    } catch {
      throw new Error(`Invalid photo URL: ${photoUrl}`);
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`Photo URL must be HTTP/HTTPS, got: ${parsedUrl.protocol}`);
    }
    // Block private/internal IP ranges to prevent SSRF
    const hostname = parsedUrl.hostname;
    const BLOCKED_PATTERNS = [
      /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
      /^0\./, /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/, /^fd/,
      /^localhost$/i, /\.local$/i, /\.internal$/i,
    ];
    if (BLOCKED_PATTERNS.some(p => p.test(hostname))) {
      throw new Error(`Photo URL hostname blocked (private/internal): ${hostname}`);
    }

    // Download image with 15s timeout
    let imageResponse;
    try {
      imageResponse = await axios.get(photoUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxRedirects: 3,
      });
    } catch (downloadErr) {
      throw new Error(`Failed to download photo from ${photoUrl}: ${downloadErr.message}`);
    }

    const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
    // Validate content type is actually an image
    if (!contentType.startsWith('image/')) {
      throw new Error(`Photo URL returned non-image content type: ${contentType}`);
    }
    const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
    const filename = `photo_${Date.now()}.${ext}`;

    const form = new FormData();
    form.append('picture', Buffer.from(imageResponse.data), {
      filename,
      contentType,
    });

    try {
      const response = await axios.post(
        `${BASE_URL}/listings/${listingId}/pictures/upload`,
        form,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...form.getHeaders(),
          },
          timeout: 30000,
        }
      );
      return response.data;
    } catch (uploadErr) {
      const status = uploadErr.response?.status;
      throw new Error(`Photo upload to listing ${listingId} failed (${status || 'network error'}): ${uploadErr.message}`);
    }
  }

  async getListingCalendarBlocks(listingId) {
    try {
      // Fetch the next 2 years of calendar blocks
      const today = new Date().toISOString().split('T')[0];
      const future = new Date(Date.now() + 730 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];
      const data = await this.request(
        'GET',
        `/listings/${listingId}/calendar?startDate=${today}&endDate=${future}`
      );
      // Return only blocked days (status === 'unavailable' with no reservation)
      const days = data.days || data.results || data || [];
      return days.filter(d =>
        (d.status === 'unavailable' || d.status === 'blocked') && !d.reservationId
      );
    } catch {
      return [];
    }
  }

  async blockListingCalendar(listingId, startDate, endDate, note = '') {
    return this.request('POST', `/listings/${listingId}/calendar/block`, {
      startDate,
      endDate,
      note,
    });
  }

  // ── Rate strategy methods ─────────────────────────────────────────────────

  async getAllRateStrategies() {
    return this.getAllPaginated('/revenue-management/rate-strategies', 'results');
  }

  async createRateStrategy() {
    throw new Error('Guesty Open API does not expose a rate strategy write endpoint. Use updateListingPricing() instead.');
  }

  async getRateStrategyByListing(unitTypeId) {
    try {
      return await this.request('GET', `/revenue-management/rate-strategies/listing/${unitTypeId}`);
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  }

  // ── Pricing calendar methods ──────────────────────────────────────────────

  async getListingPricingCalendar(listingId, days = 730) {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    try {
      const data = await this.request(
        'GET',
        `/availability-pricing/api/calendar/listings/${listingId}?startDate=${today}&endDate=${endDate}`
      );
      return data.days || data.results || [];
    } catch (err) {
      if (err.response?.status === 404) return [];
      throw err;
    }
  }

  async updateListingCalendarPricing(listingId, daysArray) {
    const CHUNK_SIZE = 90;
    const results = [];
    for (let i = 0; i < daysArray.length; i += CHUNK_SIZE) {
      const chunk = daysArray.slice(i, i + CHUNK_SIZE);
      try {
        const result = await this.request(
          'PUT',
          `/availability-pricing/api/calendar/listings/${listingId}`,
          { days: chunk }
        );
        results.push(result);
      } catch (err) {
        logger.warn('Calendar pricing update chunk failed', {
          listingId,
          chunkStart: chunk[0]?.date,
          chunkEnd: chunk[chunk.length - 1]?.date,
          error: err.response?.data?.message || err.message,
        });
      }
    }
    return results;
  }

  async updateListingPricing(listingId, priceFields) {
    return this.request('PUT', `/listings/${listingId}`, { prices: priceFields });
  }

  async updateListingAvailabilitySettings(listingId, settings) {
    return this.request('PUT', `/listings/${listingId}/availability-settings`, settings);
  }

  isChannelListing(listing) {
    return Array.isArray(listing.integrations) &&
           listing.integrations.some(i => i && (i.channelName || i.platform || i.channel));
  }
}

module.exports = GuestyClient;
