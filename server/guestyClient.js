const axios = require('axios');
const FormData = require('form-data');
const { pool } = require('./db');

const BASE_URL = 'https://open-api.guesty.com/v1';
const AUTH_URL = 'https://open-api.guesty.com/oauth2/token';

class GuestyClient {
  constructor({ clientId, clientSecret }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.maxRetries = 3;
  }

  async getAccessToken() {
    // Check cache first
    const cached = await pool.query(
      'SELECT access_token, expires_at FROM token_cache WHERE client_id = $1',
      [this.clientId]
    );

    if (cached.rows.length > 0) {
      const { access_token, expires_at } = cached.rows[0];
      if (new Date(expires_at) > new Date(Date.now() + 60000)) {
        return access_token;
      }
    }

    // Fetch new token
    const response = await axios.post(AUTH_URL, new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const { access_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    // Upsert cache
    await pool.query(
      `INSERT INTO token_cache (client_id, access_token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id) DO UPDATE SET access_token = $2, expires_at = $3`,
      [this.clientId, access_token, expiresAt]
    );

    return access_token;
  }

  async request(method, path, data = null, retries = 0) {
    const token = await this.getAccessToken();
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
        const retryAfter = parseInt(err.response.headers['retry-after'] || '1', 10);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return this.request(method, path, data, retries + 1);
      }
      throw err;
    }
  }

  async getAllPaginated(path, key) {
    const items = [];
    let skip = 0;
    const limit = 100;

    while (true) {
      const data = await this.request('GET', `${path}?skip=${skip}&limit=${limit}`);
      const results = data.results || data[key] || data;
      if (!Array.isArray(results) || results.length === 0) break;
      items.push(...results);
      if (results.length < limit) break;
      skip += limit;
    }

    return items;
  }

  async getAllCustomFields() {
    return this.getAllPaginated('/custom-fields', 'results');
  }

  async createCustomField(data) {
    return this.request('POST', '/custom-fields', data);
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

  async getAllAutomations() {
    return this.getAllPaginated('/automations', 'results');
  }

  async getAllTasks() {
    return this.getAllPaginated('/tasks-open-api/tasks', 'results');
  }

  async getCount(path) {
    try {
      const data = await this.request('GET', `${path}?skip=0&limit=1`);
      if (typeof data.count === 'number') return data.count;
      if (typeof data.total === 'number') return data.total;
      // Fallback: paginate all and count
      const all = await this.getAllPaginated(path, 'results');
      return all.length;
    } catch {
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

  async createAutomation(data) {
    return this.request('POST', '/automations', data);
  }

  async createTask(data) {
    return this.request('POST', '/tasks-open-api/tasks', data);
  }

  async uploadListingPhoto(listingId, photoUrl) {
    const token = await this.getAccessToken();

    // Download image with 15s timeout
    const imageResponse = await axios.get(photoUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });

    const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
    const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
    const filename = `photo_${Date.now()}.${ext}`;

    const form = new FormData();
    form.append('picture', Buffer.from(imageResponse.data), {
      filename,
      contentType,
    });

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
  }

  isChannelListing(listing) {
    return Array.isArray(listing.integrations) &&
           listing.integrations.some(i => i && (i.channelName || i.platform || i.channel));
  }
}

module.exports = GuestyClient;
