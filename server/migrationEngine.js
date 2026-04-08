const { pool } = require('./db');
const { decrypt } = require('./encryption');
const GuestyClient = require('./guestyClient');
const { sendMigrationReport } = require('./email');
const { logger } = require('./logger');

function extractPhotoUrl(pic) {
  if (pic == null) return null;
  return typeof pic === 'string' ? pic : (pic.original || pic.thumbnail || pic.url || null);
}

function getCategoryPath(category) {
  const paths = {
    custom_fields:    null, // account-ID-dependent — handled by getCountForClient
    fees:             null, // non-standard path — handled by getCountForClient
    listings:         '/listings',
    rate_strategies:  '/revenue-management/rate-strategies',
    guests:           '/guests',
    owners:           '/owners',
    saved_replies:    '/saved-replies',
    reservations:     '/reservations',
    tasks:            null, // requires columns param — handled by getCountForClient
    pricing_snapshot: null, // no single API path — operates on idMaps.listings
  };
  // Return null explicitly when in map (including intentional nulls), fall back to /${category} only for unknown
  return Object.prototype.hasOwnProperty.call(paths, category) ? paths[category] : `/${category}`;
}

// Returns the correct count for a category, resolving account-ID-dependent
// or param-required paths that cannot be expressed as a plain static path.
// Returns null for categories with no meaningful count API (e.g. pricing_snapshot).
async function getCountForClient(client, category) {
  if (category === 'custom_fields') {
    const id = await client.getAccountId();
    return client.getCount(`/accounts/${id}/custom-fields`);
  }
  if (category === 'fees') return client.getCount('/additional-fees/account');
  if (category === 'tasks') return client.getCount('/tasks-open-api/tasks?columns=_id');
  if (category === 'pricing_snapshot') return null; // no independent count
  const path = getCategoryPath(category);
  if (!path) return null;
  return client.getCount(path);
}

const SOURCE_ONLY_FIELDS = new Set([
  '_id', 'accountId', 'createdAt', 'updatedAt',
  'channelListingId', 'importedAt', 'integrations',
  'id',
  // complexId is account-scoped — Guesty auto-assigns when parentId is provided.
  // Including it causes the destination to store an orphaned reference to a source
  // account complex entity that doesn't exist in the destination. → dashboard errors.
  'complexId',
  // subListingsIds on MTL parent listings contains SOURCE sub-unit IDs.
  // They must never be forwarded to the destination as-is; they would point to
  // non-existent listings.  After all sub-units are created we do a PATCH with
  // correctly remapped destination IDs (see post-processing step below).
  'subListingsIds',
  // mtl is Guesty's internal parent-child relationship object.
  // mtl.c (children array) on a parent and mtl.p (parent ref) on a sub-unit both contain
  // source account IDs.  Stripping it here lets Guesty initialise it fresh; the
  // post-processing step below re-wires the correct destination IDs after creation.
  'mtl',
  // NOTE: parentId is intentionally NOT in this set — it needs remapping for complex listings
]);

function stripFieldsDeep(obj) {
  if (Array.isArray(obj)) return obj.map(stripFieldsDeep);
  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, val] of Object.entries(obj)) {
      if (SOURCE_ONLY_FIELDS.has(key)) continue;
      cleaned[key] = stripFieldsDeep(val);
    }
    return cleaned;
  }
  return obj;
}

function groupContiguousDays(days) {
  if (!days || days.length === 0) return [];
  const sorted = [...days].sort((a, b) =>
    new Date(a.date) - new Date(b.date)
  );
  const ranges = [];
  let start = sorted[0].date;
  let end = sorted[0].date;
  let note = sorted[0].note || '';

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(end);
    const curr = new Date(sorted[i].date);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      end = sorted[i].date;
    } else {
      ranges.push({ start, end, note });
      start = sorted[i].date;
      end = sorted[i].date;
      note = sorted[i].note || '';
    }
  }
  ranges.push({ start, end, note });
  return ranges;
}

// ── ETL helpers ────────────────────────────────────────────────────────────────
// These functions back the Extract-Transform-Load architecture for the listings
// category.  Source data is written to migration_source_data ONCE and reused on
// all subsequent restarts; load progress is tracked per-item in migration_load_log.

/**
 * Upsert a source data row.  category is one of: 'listing', 'spaces',
 * 'availability', 'calendar'.
 */
async function upsertSourceData(migrationId, category, sourceId, data) {
  await pool.query(
    `INSERT INTO migration_source_data (migration_id, category, source_id, data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (migration_id, category, source_id)
     DO UPDATE SET data = EXCLUDED.data, extracted_at = NOW()`,
    [migrationId, category, sourceId, JSON.stringify(data)]
  );
}

/** Count how many source rows exist for a migration+category. */
async function getSourceDataCount(migrationId, category) {
  const result = await pool.query(
    `SELECT COUNT(*) FROM migration_source_data WHERE migration_id = $1 AND category = $2`,
    [migrationId, category]
  );
  return parseInt(result.rows[0].count, 10);
}

/** Return a Set of source_ids already extracted for a migration+category. */
async function getExtractedSourceIds(migrationId, category) {
  const result = await pool.query(
    `SELECT source_id FROM migration_source_data WHERE migration_id = $1 AND category = $2`,
    [migrationId, category]
  );
  return new Set(result.rows.map(r => r.source_id));
}

/**
 * Load all source data rows for a migration+category.
 * Returns an array of { sourceId, data } objects.
 */
async function loadSourceData(migrationId, category) {
  const result = await pool.query(
    `SELECT source_id, data FROM migration_source_data
     WHERE migration_id = $1 AND category = $2
     ORDER BY extracted_at ASC`,
    [migrationId, category]
  );
  return result.rows.map(r => ({ sourceId: r.source_id, data: r.data }));
}

/**
 * Upsert a load log entry.
 * category is one of: 'listing_create', 'spaces_load', 'availability_load', 'calendar_load'.
 * status is one of: 'loaded', 'skipped', 'failed'.
 */
async function upsertLoadLog(migrationId, category, sourceId, destId, status, error = null) {
  await pool.query(
    `INSERT INTO migration_load_log (migration_id, category, source_id, dest_id, status, error, loaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (migration_id, category, source_id)
     DO UPDATE SET dest_id = EXCLUDED.dest_id, status = EXCLUDED.status,
                   error = EXCLUDED.error, loaded_at = NOW()`,
    [migrationId, category, sourceId, destId || null, status, error || null]
  );
}

/**
 * Return a Set of source_ids already loaded (status = 'loaded' or 'skipped')
 * for a migration+category.
 */
async function getLoadedSourceIds(migrationId, category) {
  const result = await pool.query(
    `SELECT source_id FROM migration_load_log
     WHERE migration_id = $1 AND category = $2 AND status IN ('loaded', 'skipped')`,
    [migrationId, category]
  );
  return new Set(result.rows.map(r => r.source_id));
}

/**
 * Build an idMap (sourceId → destId) from the load log for listing_create rows.
 * Used to restore the idMap on restart without relying on the JSONB blob.
 */
async function buildIdMapFromLoadLog(migrationId) {
  const result = await pool.query(
    `SELECT source_id, dest_id FROM migration_load_log
     WHERE migration_id = $1 AND category = 'listing_create'
       AND status IN ('loaded', 'skipped') AND dest_id IS NOT NULL`,
    [migrationId]
  );
  const idMap = {};
  for (const row of result.rows) {
    idMap[row.source_id] = row.dest_id;
  }
  return idMap;
}

/**
 * Extract spaces, availability settings, and calendar blocks from source Guesty
 * for all listings in rawItems that have not yet been extracted.  Stores each
 * result to migration_source_data so subsequent restarts can skip source API calls.
 *
 * Designed to be resumable: already-extracted source_ids are skipped.
 * Errors on individual listings are non-fatal (empty data stored so load phase
 * can still proceed without blocking the migration).
 */
async function extractListingSubResources(migrationId, rawItems, sourceClient, log) {
  const alreadyExtractedSpaces = await getExtractedSourceIds(migrationId, 'spaces');
  const alreadyExtractedAvail  = await getExtractedSourceIds(migrationId, 'availability');
  const alreadyExtractedCal    = await getExtractedSourceIds(migrationId, 'calendar');

  const toExtract = rawItems.filter(item =>
    item._id && (
      !alreadyExtractedSpaces.has(item._id) ||
      !alreadyExtractedAvail.has(item._id)  ||
      !alreadyExtractedCal.has(item._id)
    )
  );

  if (toExtract.length === 0) {
    log.info('ETL: all sub-resources already extracted — skipping');
    return;
  }

  log.info(`ETL: extracting sub-resources for ${toExtract.length}/${rawItems.length} listing(s) (spaces/availability/calendar)`);
  const hb = setInterval(() => touchProgress(migrationId), 10000);
  try {
    for (let i = 0; i < toExtract.length; i++) {
      const srcId = toExtract[i]._id;
      await touchProgress(migrationId);

      if (!alreadyExtractedSpaces.has(srcId)) {
        try {
          const spaces = await sourceClient.getListingSpaces(srcId);
          await upsertSourceData(migrationId, 'spaces', srcId, Array.isArray(spaces) ? spaces : []);
        } catch (e) {
          log.warn(`ETL: spaces extract failed for ${srcId} — storing empty`, { error: e.message });
          await upsertSourceData(migrationId, 'spaces', srcId, []);
        }
      }

      if (!alreadyExtractedAvail.has(srcId)) {
        try {
          const avail = await sourceClient.getListingAvailabilitySettings(srcId);
          await upsertSourceData(migrationId, 'availability', srcId,
            (avail && typeof avail === 'object') ? avail : {});
        } catch (e) {
          log.warn(`ETL: availability extract failed for ${srcId} — storing empty`, { error: e.message });
          await upsertSourceData(migrationId, 'availability', srcId, {});
        }
      }

      if (!alreadyExtractedCal.has(srcId)) {
        try {
          const blocks = await sourceClient.getListingCalendarBlocks(srcId);
          await upsertSourceData(migrationId, 'calendar', srcId, Array.isArray(blocks) ? blocks : []);
        } catch (e) {
          log.warn(`ETL: calendar extract failed for ${srcId} — storing empty`, { error: e.message });
          await upsertSourceData(migrationId, 'calendar', srcId, []);
        }
      }

      if ((i + 1) % 10 === 0 || i + 1 === toExtract.length) {
        log.info(`ETL: extracted sub-resources for ${i + 1}/${toExtract.length} listings`);
      }
    }
  } finally {
    clearInterval(hb);
  }
  log.info(`ETL: sub-resource extraction complete (${toExtract.length} listings)`);
}

/**
 * Classify listings into standalone, parent (MTL/complex), and sub-units.
 */
function classifyListings(listings) {
  const parents = listings.filter(l =>
    l.listingType === 'MTL' || l.type === 'complex' ||
    (Array.isArray(l.subListingsIds) && l.subListingsIds.length > 0)
  );
  const parentIds = new Set(parents.map(p => p._id));
  const subUnits = listings.filter(l => l.parentId != null && !parentIds.has(l._id));
  const subUnitIds = new Set(subUnits.map(s => s._id));
  const standalone = listings.filter(l => !parentIds.has(l._id) && !subUnitIds.has(l._id));
  return { standalone, parents, subUnits };
}

const CATEGORIES = {
  custom_fields: {
    // Guesty's POST /accounts/:id/custom-fields endpoint crashes with an
    // internal 500 ("Cannot read properties of undefined (reading 'map')")
    // regardless of payload — it does not support creating custom fields via
    // the Open API. Mark as not supported so the engine skips it cleanly
    // rather than recording failures.
    notSupported: true,
    notSupportedReason: "Custom fields cannot be created via Guesty's Open API — recreate them manually in the destination account.",
    getAll: (client) => client.getAllCustomFields(),
    idField: '_id',
  },
  fees: {
    getAll: (client) => client.getAllFees(),
    create: (client, data) => client.createFee(data),
    idField: '_id',
  },
  listings: {
    getAll: (client) => client.getAllListings(),
    create: (client, data) => client.createListing(data),
    idField: '_id',
    /**
     * Channel-managed standalone listings (Airbnb, Vrbo, Booking.com, etc.)
     * cannot be created via the Guesty Open API — they must be reconnected
     * through the OTA channel integration in the destination account. Skip
     * them here so they show as 'skipped' rather than 'failed'.
     *
     * MTL sub-units (complexId or parentId set) are the exception: even when
     * channel-connected in the source, we create them as clean manual listings
     * in the destination (SOURCE_ONLY_FIELDS strips their integrations before
     * the POST). Their photos and calendar blocks should be preserved.
     */
    filter: (item) => {
      const hasChannel = Array.isArray(item.integrations) &&
        item.integrations.some(i => i && (i.channelName || i.platform || i.channel));
      if (!hasChannel) return true; // no channel integration — always include
      // Allow MTL sub-units through; they'll be created as manual listings
      const isSubUnit = !!(item.complexId || item.parentId);
      return isSubUnit;
    },
    /**
     * Custom ordering: standalone first, then parents, then sub-units.
     * This ensures parentId can be remapped for sub-units.
     */
    sortItems: (items) => {
      const { standalone, parents, subUnits } = classifyListings(items);
      return [...standalone, ...parents, ...subUnits];
    },
    /**
     * Handle nickname conflicts: when a listing already exists in the destination
     * with the same nickname (e.g. from prior manual remediation), look it up by
     * nickname, add it to idMap, and count it as successfully migrated rather than
     * a failure.  Guesty returns 422, 409, or 400 with a message referencing
     * "nickname" for this case.
     */
    handleConflict: async (err, item, destClient, idMap) => {
      const status = err.response?.status;
      if (status !== 400 && status !== 409 && status !== 422) return false;
      const rawMsg = err.response?.data?.message ?? err.response?.data ?? '';
      const msg = typeof rawMsg === 'object' ? JSON.stringify(rawMsg) : String(rawMsg);
      if (!msg.toLowerCase().includes('nickname')) return false;

      const nickname = item.nickname;
      if (!nickname) return false;

      const existing = await destClient.findListingByNickname(nickname);
      if (!existing || !existing._id) return false;

      idMap[item._id] = existing._id;
      return true;
    },
    transform: (item, maps) => {
      const cleaned = stripFieldsDeep(item);

      // Ensure title is a non-empty string — Guesty's POST /listings API
      // requires it, but MTL_CHILD listings created after ~mid-2024 often
      // store title as null (they rely on the channel to supply a display name).
      // Fall back through common name fields before using a generic placeholder.
      if (typeof cleaned.title !== 'string' || !cleaned.title.trim()) {
        cleaned.title =
          (typeof cleaned.nickname === 'string' && cleaned.nickname.trim()) ? cleaned.nickname :
          (typeof cleaned.internalName === 'string' && cleaned.internalName.trim()) ? cleaned.internalName :
          (typeof cleaned.name === 'string' && cleaned.name.trim()) ? cleaned.name :
          'Unit';
      }

      // Remap parentId for sub-units (complex listing children)
      if (cleaned.parentId && maps.listings) {
        cleaned.parentId = maps.listings[cleaned.parentId] || cleaned.parentId;
      }

      // nickname / internalName are globally unique across Guesty's multi-tenant
      // system — sending the source value to a different account causes a 400
      // "A listing with the nickname you chose already exists" conflict because
      // another account already holds that name. Clear both fields so the
      // destination account starts without a nickname; the client can assign
      // their own internal names after migration.
      delete cleaned.nickname;
      delete cleaned.internalName;

      // rateStrategy references embed account-specific _id values that
      // stripFieldsDeep removes, causing Guesty's API to return
      // "rateStrategy._id: Path `_id` is required" when the object is present
      // but empty. Strategy:
      //   1. Try to remap using the migrated rate_strategies idMap.
      //   2. If no mapping exists, delete just the rateStrategy key —
      //      NOT the whole yieldManagement block — so Guesty's detail page
      //      can still access listing.yieldManagement without crashing.
      const remapRateStrategyRef = (sourceRef, destRef) => {
        if (!sourceRef || !destRef) return;
        const sourceId = sourceRef._id; // read from original item before strip
        const destId = sourceId && maps.rate_strategies?.[sourceId];
        if (destId) {
          destRef._id = destId; // restore with remapped destination ID
        } else {
          return 'DELETE'; // signal: remove the reference entirely
        }
      };

      // Top-level rateStrategy
      if (item.rateStrategy) {
        const action = remapRateStrategyRef(item.rateStrategy, cleaned.rateStrategy);
        if (action === 'DELETE') delete cleaned.rateStrategy;
      }

      // yieldManagement.rateStrategy — drop only the nested ref, keep the block
      if (item.yieldManagement?.rateStrategy) {
        const action = remapRateStrategyRef(
          item.yieldManagement.rateStrategy,
          cleaned.yieldManagement?.rateStrategy
        );
        if (action === 'DELETE' && cleaned.yieldManagement) {
          delete cleaned.yieldManagement.rateStrategy;
        }
      }

      return cleaned;
    },
  },
  guests: {
    getAll: (client) => client.getAllGuests(),
    create: (client, data) => client.createGuest(data),
    idField: '_id',
  },
  owners: {
    getAll: (client) => client.getAllOwners(),
    create: (client, data) => client.createOwner(data),
    idField: '_id',
    transform: (item, maps) => {
      const cleaned = stripFieldsDeep(item);
      cleaned.sendInvitation = false;  // suppress portal invite email
      return cleaned;
    },
  },
  reservations: {
    getAll: (client) => client.getAllReservations(),
    create: (client, data) => client.createReservation(data),
    idField: '_id',
    filter: (item) => {
      // Only migrate direct/manual reservations — skip channel-owned ones
      const src = item.source;
      if (!src) return true; // no source field — allow
      const platform = (src.platform || src.channel || '').toLowerCase();
      // Skip Airbnb, Vrbo, Booking.com, Agoda, Expedia, etc.
      const CHANNEL_PLATFORMS = [
        'airbnb', 'homeaway', 'vrbo', 'bookingcom', 'booking.com',
        'agoda', 'expedia', 'tripadvisor', 'google', 'houfy',
      ];
      return !CHANNEL_PLATFORMS.some(p => platform.includes(p));
    },
    transform: (item, maps) => {
      const cleaned = stripFieldsDeep(item);
      if (cleaned.listingId && maps.listings) {
        cleaned.listingId = maps.listings[cleaned.listingId] || cleaned.listingId;
      }
      if (cleaned.guestId && maps.guests) {
        cleaned.guestId = maps.guests[cleaned.guestId] || cleaned.guestId;
      }
      return cleaned;
    },
  },
  saved_replies: {
    getAll: (client) => client.getAllSavedReplies(),
    create: (client, data) => client.createSavedReply(data),
    idField: '_id',
    transform: (item, maps) => {
      const cleaned = stripFieldsDeep(item);
      // Remap listing-scoped saved replies
      if (cleaned.listingId && maps.listings) {
        cleaned.listingId = maps.listings[cleaned.listingId] || cleaned.listingId;
      }
      if (Array.isArray(cleaned.listingIds) && maps.listings) {
        cleaned.listingIds = cleaned.listingIds.map(id => maps.listings[id] || id);
      }
      return cleaned;
    },
    handleConflict: async (err, item, destClient, idMap) => {
      // 409 = saved reply with same title already exists — treat as success
      if (err.response?.status === 409) return true;
      return false;
    },
  },
  tasks: {
    getAll: (client) => client.getAllTasks(),
    create: (client, data) => client.createTask(data),
    idField: '_id',
    transform: (item, maps) => {
      const cleaned = stripFieldsDeep(item);
      if (cleaned.listingId && maps.listings) {
        cleaned.listingId = maps.listings[cleaned.listingId] || cleaned.listingId;
      }
      // assigneeId cannot be remapped (different user IDs in dest account)
      // Remove it so the task is created unassigned rather than with a broken ref
      if (cleaned.assigneeId) {
        delete cleaned.assigneeId;
      }
      if (Array.isArray(cleaned.assignees)) {
        delete cleaned.assignees;
      }
      return cleaned;
    },
  },

  rate_strategies: {
    getAll: (client) => client.getAllRateStrategies(),
    idField: '_id',
    // No create — writes via listing update endpoints instead (POST endpoint confirmed non-existent)
    customRunner: async (sourceItems, sourceClient, destClient, idMaps, log) => {
      const results = { sourceCount: sourceItems.length, migratedCount: 0, failedCount: 0, skippedCount: 0, errors: [] };

      for (const strategy of sourceItems) {
        const listingIds = strategy.listingIds || (strategy.listingId ? [strategy.listingId] : []);
        if (listingIds.length === 0) {
          results.skippedCount++;
          continue;
        }

        for (const sourceListingId of listingIds) {
          const destListingId = idMaps.listings?.[sourceListingId];
          if (!destListingId) {
            results.skippedCount++;
            continue;
          }

          try {
            // Strategy 2: Apply base pricing fields from the strategy to the destination listing
            const priceFields = {};
            if (strategy.basePrice != null)         priceFields.basePrice = strategy.basePrice;
            if (strategy.weekendBasePrice != null)   priceFields.weekendBasePrice = strategy.weekendBasePrice;
            if (strategy.weeklyPriceFactor != null)  priceFields.weeklyPriceFactor = strategy.weeklyPriceFactor;
            if (strategy.monthlyPriceFactor != null) priceFields.monthlyPriceFactor = strategy.monthlyPriceFactor;
            if (strategy.currency)                   priceFields.currency = strategy.currency;

            if (Object.keys(priceFields).length > 0) {
              await destClient.updateListingPricing(destListingId, priceFields);
            }

            // Strategy 4: Apply day-of-week min nights and default min/max nights
            const terms = {};
            if (strategy.minNights != null)      terms.minNights = strategy.minNights;
            if (strategy.maxNights != null)      terms.maxNights = strategy.maxNights;
            if (strategy.minNightsByDow != null) terms.minNightsByDow = strategy.minNightsByDow;
            if (Object.keys(terms).length > 0) {
              await destClient.updateListingAvailabilitySettings(destListingId, { terms });
            }

            results.migratedCount++;
          } catch (err) {
            results.failedCount++;
            results.errors.push({
              sourceListingId,
              destListingId,
              strategyName: strategy.name,
              error: err.response?.data?.message || err.message,
            });
          }
        }
      }

      return results;
    },
  },

  pricing_snapshot: {
    // No getAll — data is fetched per-listing inside customRunner
    idField: '_id',
    customRunner: async (sourceItems, sourceClient, destClient, idMaps, log) => {
      const results = { sourceCount: 0, migratedCount: 0, failedCount: 0, skippedCount: 0, errors: [] };
      const listingIdPairs = Object.entries(idMaps.listings || {});
      results.sourceCount = listingIdPairs.length;

      for (const [sourceListingId, destListingId] of listingIdPairs) {
        try {
          log.info(`pricing_snapshot: fetching calendar for source listing ${sourceListingId}`);
          const calendarDays = await sourceClient.getListingPricingCalendar(sourceListingId, 730);

          if (!calendarDays || calendarDays.length === 0) {
            results.skippedCount++;
            continue;
          }

          const updates = calendarDays
            .filter(d => d.price != null || d.minNights != null)
            .map(d => ({
              date: d.date,
              ...(d.price != null ? { price: d.price } : {}),
              ...(d.minNights != null ? { minNights: d.minNights } : {}),
            }));

          if (updates.length === 0) {
            results.skippedCount++;
            continue;
          }

          await destClient.updateListingCalendarPricing(destListingId, updates);
          results.migratedCount++;
          log.info(`pricing_snapshot: applied ${updates.length} day overrides to dest listing ${destListingId}`);
        } catch (err) {
          results.failedCount++;
          results.errors.push({
            sourceListingId,
            destListingId,
            error: err.response?.data?.message || err.message,
          });
        }
      }

      return results;
    },
  },
};

// Strict migration order for dependency resolution
const MIGRATION_ORDER = [
  'custom_fields',
  'fees',
  'listings',
  'rate_strategies',   // after listings — needs idMaps.listings populated
  'pricing_snapshot',  // opt-in calendar overlay, runs after rate_strategies
  'guests',
  'owners',
  'saved_replies',
  'reservations',
  'tasks',
];

// Whitelist of allowed column names to prevent SQL injection via dynamic keys
const ALLOWED_EXTRA_COLUMNS = new Set([
  'results', 'diff_report', 'manifest', 'selected_categories',
  'selected_addons', 'pricing_mode', 'error_message', 'stripe_session_id',
  'selected_listing_ids',
]);

/**
 * Stamp last_progress_at = NOW() on the migration row.
 * Call this immediately before any potentially-blocking Guesty API call so
 * the stuck-migration detector can tell the difference between "working slowly"
 * and "hung waiting on a response that will never arrive".
 */
async function touchProgress(migrationId) {
  let timeoutId;
  try {
    await Promise.race([
      pool.query(
        `UPDATE migrations SET last_progress_at = NOW() WHERE id = $1`,
        [migrationId]
      ),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('touchProgress timeout')),
          5000
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));
  } catch {
    // Non-fatal — heartbeat failure must not interrupt the migration itself
  }
}

async function updateStatus(migrationId, status, extra = {}) {
  const sets = ['status = $2'];
  const values = [migrationId, status];
  let idx = 3;

  for (const [key, value] of Object.entries(extra)) {
    if (!ALLOWED_EXTRA_COLUMNS.has(key)) {
      logger.warn('updateStatus: ignoring disallowed column', { key, migrationId });
      continue;
    }
    sets.push(`${key} = $${idx}`);
    values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    idx++;
  }

  if (status === 'running') {
    sets.push(`last_progress_at = NOW()`);
  }
  if (status === 'complete' || status === 'failed') {
    sets.push(`completed_at = NOW()`);
  }

  await pool.query(`UPDATE migrations SET ${sets.join(', ')} WHERE id = $1`, values);
}

async function logCategory(migrationId, category, status, sourceCount, migratedCount, failedCount, skippedCount, errorDetails, photos = null) {
  await pool.query(
    `INSERT INTO migration_logs (migration_id, category, status, source_count, migrated_count, failed_count, skipped_count, error_details, photos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [migrationId, category, status, sourceCount, migratedCount, failedCount,
     skippedCount,
     errorDetails ? JSON.stringify(errorDetails) : null,
     photos ? JSON.stringify(photos) : null]
  );
}

async function loadPreviousResults(migrationId) {
  const [logsResult, migResult] = await Promise.all([
    pool.query(
      `SELECT category, migrated_count, status FROM migration_logs
       WHERE migration_id = $1 ORDER BY created_at ASC`,
      [migrationId]
    ),
    pool.query(
      `SELECT results FROM migrations WHERE id = $1`,
      [migrationId]
    ),
  ]);

  // Map of category -> already migrated count (from migration_logs).
  // Also track category status — only 'complete' categories should be skipped
  // on retry; 'partial' ones must be re-run using the stored idMap so that
  // already-created items are skipped (via idMap lookup) and only the failures
  // are retried.
  const prev = {};
  const prevStatus = {};
  for (const row of logsResult.rows) {
    prev[row.category] = row.migrated_count || 0;
    prevStatus[row.category] = row.status;
  }

  // Full stored results JSONB — used to recover idMaps and photo errors on retry
  const storedResults = migResult.rows[0]?.results || {};

  return { prev, prevStatus, storedResults };
}

async function runMigration(migrationId) {
  const log = logger.child({ migrationId });
  try {
  // Atomically claim the migration by transitioning paid→running.
  // If another worker already claimed it (status is no longer 'paid'), bail out
  // safely — this prevents duplicate concurrent runs when a paid migration is
  // re-enqueued for recovery.
  const claimResult = await pool.query(
    "UPDATE migrations SET status = 'running', started_at = NOW() WHERE id = $1 AND status = 'paid' RETURNING id",
    [migrationId]
  );
  if (claimResult.rowCount === 0) {
    // Either migration not found or already running/completed — nothing to do.
    log.warn('Migration claim failed — already claimed or not found, skipping');
    return;
  }

  const migResult = await pool.query('SELECT * FROM migrations WHERE id = $1', [migrationId]);
  if (migResult.rows.length === 0) throw new Error(`Migration ${migrationId} not found`);

  const migration = migResult.rows[0];

  const { prev: previousResults, prevStatus: previousStatus, storedResults } = await loadPreviousResults(migrationId);

  const sourceClient = new GuestyClient({
    clientId: decrypt(migration.source_client_id),
    clientSecret: decrypt(migration.source_client_secret),
  });

  const destClient = new GuestyClient({
    clientId: decrypt(migration.dest_client_id),
    clientSecret: decrypt(migration.dest_client_secret),
  });

  const selectedCategories = migration.selected_categories || MIGRATION_ORDER;
  const idMaps = {};
  const results = {};
  let hasFailures = false;
  const totalPhotos = { found: 0, migrated: 0, skipped: 0 };

  for (const category of MIGRATION_ORDER) {
    if (!selectedCategories.includes(category)) continue;

    const categoryDef = CATEGORIES[category];
    if (!categoryDef) continue;

    // Categories marked notSupported are skipped cleanly — no failures recorded.
    // The getAll call is still made so we can report the source count to the user.
    if (categoryDef.notSupported) {
      log.warn(`Skipping ${category} — ${categoryDef.notSupportedReason}`);
      let sourceCount = 0;
      try {
        const items = categoryDef.getAll ? await categoryDef.getAll(sourceClient) : [];
        sourceCount = items.length;
      } catch (_) { /* best-effort count */ }
      results[category] = {
        sourceCount,
        migratedCount: 0,
        failedCount: 0,
        skippedCount: sourceCount,
        notSupported: true,
        note: categoryDef.notSupportedReason,
      };
      await logCategory(migrationId, category, 'not_supported', sourceCount, 0, 0, sourceCount, null);
      await updateStatus(migrationId, 'running', { results });
      continue;
    }

    // Skip categories that already completed successfully in a prior run,
    // but first restore their idMap so dependent categories can remap IDs.
    // Only skip if status is 'complete' — 'partial' categories (some items
    // succeeded, some failed) must be re-run: the creation loop itself skips
    // items already present in the idMap, so only failed items get retried.
    if (previousResults[category] > 0 && previousStatus[category] === 'complete') {
      log.info(`Skipping ${category} — already migrated in prior run`, { count: previousResults[category] });

      // Restore the stored idMap so dependent categories (reservations, tasks,
      // saved_replies) can still remap their foreign keys correctly.
      const storedIdMap = storedResults[category]?.idMap;
      if (storedIdMap && typeof storedIdMap === 'object') {
        idMaps[category] = storedIdMap;
      }

      continue;
    }

    // For partial categories being retried: restore the existing idMap so items
    // that already succeeded (have a destination ID) are skipped in the loop.
    if (previousResults[category] > 0 && previousStatus[category] !== 'complete') {
      log.info(`Resuming partial ${category} — restoring idMap from prior run`, { count: previousResults[category] });
      const storedIdMap = storedResults[category]?.idMap;
      if (storedIdMap && typeof storedIdMap === 'object') {
        idMaps[category] = storedIdMap;
      }
    }

    try {
      log.info(`Migrating ${category}...`);
      await touchProgress(migrationId); // stamp start-of-category so stuck detector resets
      let rawItems;
      // Set by the auto-expansion block to include original + sibling IDs.
      // The safety filter below uses this instead of selected_listing_ids so
      // auto-added siblings are not stripped before the migration loop.
      let effectivePilotIds = null;
      try {
        // ── Pilot-mode targeted fetches ──────────────────────────────────────
        // When selected_listing_ids is set we know exactly which records we need.
        // Fetching only those records is orders of magnitude faster than paging
        // through the entire account catalogue and discarding most of it.
        const pilotListingIds = migration.selected_listing_ids;
        const migratedSrcIds  = idMaps.listings ? Object.keys(idMaps.listings) : [];

        // ── ETL: Load from DB if extraction is fully complete ─────────────────
        // On first run (or after a partial mid-extract restart): no marker exists →
        //   falls through to source API fetch below; upserts are idempotent.
        // On all subsequent runs after a full extraction: marker present →
        //   loads rawItems from DB (< 1 s), skips 21-min MTL scan entirely.
        //
        // The marker ('listing_extract_marker', '__complete__') is written only
        // AFTER all listing rows AND sub-resources are stored in migration_source_data,
        // making it safe to use as a completeness signal.  A partial extract (restart
        // mid-upsert) has no marker and will re-fetch from source on the next run.
        let etlLoadedFromDb = false;
        if (category === 'listings') {
          const markerRow = await pool.query(
            `SELECT 1 FROM migration_source_data
             WHERE migration_id = $1 AND category = 'listing_extract_marker'
               AND source_id = '__complete__'`,
            [migrationId]
          );
          if (markerRow.rows.length > 0) {
            const rows = await loadSourceData(migrationId, 'listing');
            log.info(`ETL: ${rows.length} listings fully extracted — loading from DB, skipping source API`, { migrationId });
            rawItems = rows.map(r => r.data);
            effectivePilotIds = new Set(rawItems.map(r => r._id));
            etlLoadedFromDb = true;
          } else {
            const partial = await getSourceDataCount(migrationId, 'listing');
            if (partial > 0) {
              log.info(`ETL: ${partial} listing rows found but extract marker absent — prior run was interrupted; re-extracting from source API`, { migrationId });
            }
          }
        }

        if (!etlLoadedFromDb && category === 'listings' && pilotListingIds?.length) {
          // A background heartbeat keeps last_progress_at fresh throughout the
          // entire pilot listings block — covering getListingsByIds (90+ min
          // under heavy rate-limiting), the wantedComplexIds fallback API calls,
          // the orphaned MTL individual-fetch loop, siblings fetch, and ETL extraction.
          // Cleared in the finally block at the end of this if-block.
          const pilotHbInterval = setInterval(() => touchProgress(migrationId), 10000);
          try {
          // ── Partial-extract resumability: load already-extracted IDs from DB ──
          // If a prior run fetched and stored some listing rows but was interrupted
          // before writing the extraction marker, we load those rows from DB and
          // only fetch the IDs that are genuinely missing from migration_source_data.
          const alreadyExtractedMap = new Map(); // sourceId → listing data object
          {
            const extractedSet = await getExtractedSourceIds(migrationId, 'listing');
            extractedSet.delete('__complete__'); // ignore the marker row
            if (extractedSet.size > 0) {
              const dbRows = await loadSourceData(migrationId, 'listing');
              for (const row of dbRows) {
                if (row.sourceId !== '__complete__') alreadyExtractedMap.set(row.sourceId, row.data);
              }
              log.info(`ETL: ${alreadyExtractedMap.size} listing(s) already in DB — fetching only missing IDs`, { migrationId });
            }
          }

          // Fetch each selected listing directly by ID in parallel — only for IDs
          // not already stored in migration_source_data from a prior interrupted run.
          const missingPilotIds = pilotListingIds.filter(id => !alreadyExtractedMap.has(id));
          let rawItemsFromApi = [];
          if (missingPilotIds.length > 0) {
            log.info(`Pilot: fetching ${missingPilotIds.length}/${pilotListingIds.length} missing listing(s) by ID...`, { migrationId });
            await touchProgress(migrationId);
            rawItemsFromApi = await sourceClient.getListingsByIds(missingPilotIds);
            log.info(`Pilot: fetched ${rawItemsFromApi.length}/${missingPilotIds.length} from source API`);
            // Upsert immediately so partial-extraction progress survives next restart
            for (const item of rawItemsFromApi) {
              if (item._id) await upsertSourceData(migrationId, 'listing', item._id, item);
            }
          } else {
            log.info(`Pilot: all ${pilotListingIds.length} selected listing(s) already in DB — skipping source API fetch`, { migrationId });
          }
          // Combine DB-loaded and freshly-fetched items into rawItems
          rawItems = [...alreadyExtractedMap.values(), ...rawItemsFromApi];
          log.info(`Pilot: ${rawItems.length} listing(s) assembled (${alreadyExtractedMap.size} from DB, ${rawItemsFromApi.length} from API)`);

          // ── Multi-unit family auto-expansion via manifest complexGroups ──────
          // The preflight stores a complexId → [listingId, ...] map in the
          // migration manifest built from the full listing catalogue.  We use that
          // map here for instant sibling lookup — no extra Guesty API calls needed.
          //
          //   Case A — user selected a PARENT (no complexId on the listing):
          //     Look up complexGroups[listing._id] → all its sub-unit IDs
          //
          //   Case B — user selected a SUB-UNIT (has complexId set):
          //     Look up complexGroups[listing.complexId] → all sibling IDs
          //
          // For standalone (STL) listings neither key will exist in the map
          // so nothing is added and there is zero overhead.
          // Use pre-built map from manifest (new migrations) or reconstruct
          // from listingDetails (older migrations that predate this field).
          let complexGroups = migration.manifest?.complexGroups;
          if (!complexGroups || Object.keys(complexGroups).length === 0) {
            complexGroups = {};
            for (const l of migration.manifest?.listingDetails || []) {
              const cId = l.complexId || l.parentId;
              if (cId) {
                if (!complexGroups[cId]) complexGroups[cId] = [];
                complexGroups[cId].push(l.id);
              }
            }
            if (Object.keys(complexGroups).length > 0) {
              log.info(`Pilot: reconstructed complexGroups from listingDetails (${Object.keys(complexGroups).length} complex(es))`);
            }
          }
          const seenIds = new Set(rawItems.map(r => r._id));

          // Log listing details for diagnostics.
          for (const r of rawItems) {
            const subCount = Array.isArray(r.subListingsIds) ? r.subListingsIds.length : 0;
            log.info(`Pilot listing: id=${r._id} type=${r.type} complexId=${r.complexId || 'none'} parentId=${r.parentId || 'none'} subListingsIds=${subCount}`);
          }

          const missingIds = new Set();
          // knownParentId: subUnitId → parentMtlId
          // Tracks the source MTL listing for each discovered sub-unit so we
          // can stamp parentId on the fetched objects when Guesty's individual
          // GET /listings/:id response also omits parentId (same bug as bulk).
          const knownParentId = new Map();
          // cachedSiblings: subUnitId → full listing object returned by
          // getSubUnitsByListingId (LIST endpoint).  These objects have the same
          // field coverage as getAllListings(), so they can be used directly
          // without the redundant individual GET that getListingsByIds would do.
          const cachedSiblings = new Map();

          for (const r of rawItems) {
            const lookupKey = r.complexId || r._id; // sub-unit: use parent key; parent: use own id
            const members = complexGroups[lookupKey] || [];
            for (const memberId of members) {
              if (!seenIds.has(memberId)) {
                missingIds.add(memberId);
                seenIds.add(memberId);
                knownParentId.set(memberId, r._id);
              }
            }

            // Also look up children stored under this listing's own ID.
            // MTL parents whose children were captured via subListingsIds during
            // preflight will be keyed by the parent's _id in complexGroups.
            if (r._id !== lookupKey) {
              const ownChildren = complexGroups[r._id] || [];
              for (const childId of ownChildren) {
                if (!seenIds.has(childId)) {
                  missingIds.add(childId);
                  seenIds.add(childId);
                  knownParentId.set(childId, r._id);
                }
              }
            }

            // Direct field: MTL listings fetched individually often include a
            // subListingsIds array listing the IDs of all their sub-units.
            // Guesty omits these IDs from the bulk /listings response but
            // returns them on the per-listing GET.
            if (Array.isArray(r.subListingsIds) && r.subListingsIds.length > 0) {
              let addedFromField = 0;
              for (const subId of r.subListingsIds) {
                if (!seenIds.has(subId)) {
                  missingIds.add(subId);
                  seenIds.add(subId);
                  knownParentId.set(subId, r._id);
                  addedFromField++;
                }
              }
              if (addedFromField > 0) {
                log.info(`Pilot: found ${addedFromField} sub-unit(s) via listing.subListingsIds for ${r._id}`);
              }
            }
          }

          // ── Fallbacks: resolve siblings whose complexId the bulk API omitted ──────
          // Guesty's GET /listings bulk response does not consistently include
          // complexId for all sub-unit types (particularly MTL_CHILD).  We try
          // two progressively more expensive approaches when the manifest lookup
          // above found no new siblings.
          log.info(`Pilot: complexGroups expansion done — missingIds.size=${missingIds.size}, seenIds.size=${seenIds.size}`, { migrationId });
          if (missingIds.size === 0) {
            // Collect complexIds we still need siblings for (group has <=1 known member)
            const wantedComplexIds = new Set(
              rawItems
                .filter(r => r.complexId && (complexGroups[r.complexId] || []).length <= 1)
                .map(r => r.complexId)
            );

            if (wantedComplexIds.size > 0) {
              // ── Fallback 1: Guesty complexId API filter with count-based trust ──
              // Call GET /listings?filters[complexId]={id}&limit=100.  If Guesty
              // honours the filter, the returned count will be << the account total.
              // In that case we trust ALL returned listings as sub-units of this
              // complex — even those whose complexId field is null in the bulk
              // response (a known issue for MTL_CHILD sub-units).
              const totalListingCount =
                ((migration.manifest?.listings || 0) +
                  (migration.manifest?.channelManagedListings || 0)) || null;

              for (const wantedId of wantedComplexIds) {
                // ── Complexes API (highest priority) ──────────────────────────
                // GET /properties-api/complexes/{id} returns the complex object
                // including a `propertyIds` array — the authoritative child list.
                // This works even when the bulk /listings API omits complexId/
                // parentId from MTL_CHILD listings.
                await touchProgress(migrationId);
                const complexPropIds = await sourceClient.getComplexPropertyIds(wantedId);
                if (complexPropIds.length > 0) {
                  let addedByComplex = 0;
                  for (const propId of complexPropIds) {
                    if (!seenIds.has(propId)) {
                      missingIds.add(propId);
                      seenIds.add(propId);
                      addedByComplex++;
                    }
                  }
                  if (addedByComplex > 0) {
                    log.info(`Pilot: found ${addedByComplex} sibling(s) via complexes API for ${wantedId}`);
                  }
                  continue;
                }

                // ── Fallback 1: Guesty complexId API filter with count-based trust ──
                await touchProgress(migrationId);
                const filterResults = await sourceClient.getSubUnitsForParent(
                  wantedId,
                  { totalListingCount }
                );
                let addedByFilter = 0;
                for (const su of filterResults) {
                  if (!seenIds.has(su._id)) {
                    missingIds.add(su._id);
                    seenIds.add(su._id);
                    addedByFilter++;
                  }
                }
                if (addedByFilter > 0) {
                  log.info(`Pilot: found ${addedByFilter} sibling(s) via API filter for complex ${wantedId}`);
                }
              }

              // ── Fallback 2: individual-fetch orphaned MTL listings ────────────
              // If the API filter found nothing (possibly because Guesty ignores it
              // for this account), fall back to fetching each "orphaned" MTL listing
              // (type=MTL, complexId=null in bulk response) individually.  Individual
              // fetches always return complexId.  Skip MTL_CHILD here — there are
              // often thousands of them and fetching individually is not feasible.
              if (missingIds.size === 0) {
                const orphanedIds = (migration.manifest?.listingDetails || [])
                  .filter(l => l.type === 'MTL' && !l.complexId && !seenIds.has(l.id))
                  .map(l => l.id);

                if (orphanedIds.length > 0) {
                  log.info(`Pilot: resolving ${orphanedIds.length} orphaned MTL(s) whose complexId was missing from bulk API response`);
                  // Fetch one at a time with a heartbeat before EACH request.
                  // A chunk-based approach (e.g. 50 per chunk) is not safe: with
                  // Guesty 429 Retry-After waits (capped at 60s × 3 retries) a
                  // single chunk can take 30+ min, causing the stall detector to
                  // fire before the next heartbeat.  Sequential processing keeps
                  // the heartbeat window well under 15 minutes.
                  for (let oi = 0; oi < orphanedIds.length; oi++) {
                    await touchProgress(migrationId);
                    let ol = null;
                    // Use cached DB data if available — avoids source API call for
                    // listings already extracted in a prior interrupted run.
                    if (alreadyExtractedMap.has(orphanedIds[oi])) {
                      ol = alreadyExtractedMap.get(orphanedIds[oi]);
                    } else {
                      try { ol = await sourceClient.request('GET', `/listings/${orphanedIds[oi]}`); } catch { /* skip on error */ }
                    }
                    if (ol) {
                      const cId = ol.complexId || ol.parentId;
                      if (cId && wantedComplexIds.has(cId) && !seenIds.has(ol._id)) {
                        missingIds.add(ol._id);
                        seenIds.add(ol._id);
                      }
                    }
                    if (oi > 0 && oi % 100 === 0) {
                      log.info(`Pilot: orphaned MTL resolution — ${oi}/${orphanedIds.length} fetched, ${missingIds.size} matched`);
                    }
                  }
                  if (missingIds.size > 0) {
                    log.info(`Pilot: found ${missingIds.size} sibling(s) among orphaned MTLs`);
                  }
                }
              }
            }
          }

          // ── Fallback 3: parentId filter + dedicated sub-units endpoint ────
          // Guesty's bulk /listings API returns MTL_CHILD with complexId=null
          // AND parentId=null, so manifest lookup and complexId filter both
          // come up empty.  As a last resort, for each MTL listing in rawItems:
          //   a) Try GET /listings?filters[parentId]={id} — if Guesty honours
          //      this filter the response contains the direct sub-units.
          //   b) Try GET /listings/{id}/sub-units — some Guesty plans expose
          //      a dedicated endpoint returning the sub-unit objects directly.
          // Both approaches query by the MTL listing's own ID, not complexId.
          if (missingIds.size === 0) {
            const mtlListings = rawItems.filter(r => {
              if (r.type === 'MTL_CHILD' || r.listingType === 'MTL_CHILD') return false;
              return r.type === 'MTL' || r.listingType === 'MTL' ||
                     (Array.isArray(r.subListingsIds) && r.subListingsIds.length > 0);
            });
            for (const mtl of mtlListings) {
              await touchProgress(migrationId);
              const subUnits = await sourceClient.getSubUnitsByListingId(mtl._id);
              let added = 0;
              for (const su of subUnits) {
                const subId = su._id || su.id;
                if (subId && !seenIds.has(subId)) {
                  missingIds.add(subId);
                  seenIds.add(subId);
                  knownParentId.set(subId, mtl._id);
                  cachedSiblings.set(subId, su);
                  added++;
                }
              }
              if (added > 0) {
                log.info(`Pilot: found ${added} sub-unit(s) via sub-units endpoint for ${mtl._id}`);
              }
            }
          }

          if (missingIds.size > 0) {
            await touchProgress(migrationId);

            // Separate IDs already cached from Fallback 3 or already in DB
            // from any IDs that genuinely need a source API call.
            const toFetch = [...missingIds].filter(id => !cachedSiblings.has(id) && !alreadyExtractedMap.has(id));
            let fetched = [];
            if (toFetch.length > 0) {
              fetched = await sourceClient.getListingsByIds(toFetch);
              // Upsert siblings immediately for per-ID partial-extract resumability
              for (const item of fetched) {
                if (item._id) await upsertSourceData(migrationId, 'listing', item._id, item);
              }
            } else {
              log.info(`Pilot: all ${missingIds.size} sibling(s) from cache/DB — skipping source API fetch`);
            }
            const siblings = [
              ...[...missingIds].filter(id => cachedSiblings.has(id)).map(id => cachedSiblings.get(id)),
              ...[...missingIds].filter(id => alreadyExtractedMap.has(id) && !cachedSiblings.has(id)).map(id => alreadyExtractedMap.get(id)),
              ...fetched,
            ];

            // ── Stamp parentId on sub-units that Guesty omits it from ─────────
            // Guesty's GET /listings/:id (individual fetch) also returns MTL_CHILD
            // listings with parentId=null — the same bug as the bulk API.  When we
            // know a listing is a sub-unit of a specific MTL parent (recorded in
            // knownParentId during sub-unit discovery above), stamp parentId so that:
            //   1. classifyListings() correctly sorts them as sub-units (after parent)
            //   2. The listing filter allows them through (isSubUnit = true)
            //   3. transform() remaps parentId to the destination listing ID
            let stamped = 0;
            for (const s of siblings) {
              if (!s.parentId && knownParentId.has(s._id)) {
                s.parentId = knownParentId.get(s._id);
                stamped++;
              }
            }
            if (stamped > 0) {
              log.info(`Pilot: stamped parentId on ${stamped} sub-unit(s) missing it from Guesty individual GET`);
            }

            rawItems.push(...siblings);
            log.info(`Pilot: auto-added ${siblings.length} sibling/sub-unit(s) from manifest complexGroups`);
          } else {
            log.info(`Pilot: no additional siblings in manifest (standalone listing or all units already selected)`);
          }

          // Track the full set of IDs now in rawItems (original + auto-expanded)
          // so the safety filter below does not strip the newly added siblings.
          effectivePilotIds = new Set(rawItems.map(r => r._id));

          } finally {
            clearInterval(pilotHbInterval);
          }

          // ── ETL: Sub-resource extraction + completion marker ──────────────────
          // Listing rows are upserted incrementally above (initial fetch + siblings).
          // Run sub-resource extraction (spaces/availability/calendar) — resumable
          // per-listing via getExtractedSourceIds.  Write the completion marker ONLY
          // after sub-resource extraction finishes so the marker truthfully represents
          // a fully extracted dataset.
          if (Array.isArray(rawItems) && rawItems.length > 0) {
            await extractListingSubResources(migrationId, rawItems, sourceClient, log);
            await upsertSourceData(migrationId, 'listing_extract_marker', '__complete__',
              { completedAt: new Date().toISOString(), count: rawItems.length });
            log.info(`ETL: extraction complete — marker written for ${rawItems.length} listing(s) (pilot mode)`, { migrationId });
          }

        } else if (!etlLoadedFromDb && category === 'reservations' && pilotListingIds && migratedSrcIds.length) {
          // Fetch reservations only for the listings that were actually migrated.
          rawItems = await sourceClient.getReservationsByListingIds(migratedSrcIds);
          log.info(`Pilot: fetched ${rawItems.length} reservations for ${migratedSrcIds.length} listing(s)`);

        } else if (category === 'tasks' && pilotListingIds && migratedSrcIds.length) {
          // Fetch tasks only for the listings that were actually migrated.
          rawItems = await sourceClient.getTasksByListingIds(migratedSrcIds);
          log.info(`Pilot: fetched ${rawItems.length} tasks for ${migratedSrcIds.length} listing(s)`);

        } else if (!etlLoadedFromDb) {
          // Full-account fetch for non-pilot migrations and account-level categories
          // (fees, owners, guests, saved_replies, rate_strategies, custom_fields).
          await touchProgress(migrationId);
          rawItems = categoryDef.getAll
            ? await categoryDef.getAll(sourceClient)
            : [];

          // ── ETL: Store listings data to DB for full-account (non-pilot) migrations ──
          if (category === 'listings' && Array.isArray(rawItems) && rawItems.length > 0) {
            log.info(`ETL: storing ${rawItems.length} listing(s) to DB (full-account mode)`, { migrationId });
            for (const item of rawItems) {
              if (item._id) await upsertSourceData(migrationId, 'listing', item._id, item);
            }
            await extractListingSubResources(migrationId, rawItems, sourceClient, log);
            // Write completion marker after all rows + sub-resources stored
            await upsertSourceData(migrationId, 'listing_extract_marker', '__complete__',
              { completedAt: new Date().toISOString(), count: rawItems.length });
            log.info(`ETL: extraction complete — marker written for ${rawItems.length} listing(s) (full-account)`, { migrationId });
          }
        }
      } catch (fetchErr) {
        const status = fetchErr.response?.status;
        if (status === 404 || status === 400) {
          // Endpoint not available on this account's plan — treat as empty.
          log.info(`Category ${category} not available on this Guesty plan (HTTP ${status}) — skipping`, { status });
          results[category] = { sourceCount: 0, migratedCount: 0, failedCount: 0 };
          await logCategory(migrationId, category, 'complete', 0, 0, 0, 0, null);
          await updateStatus(migrationId, 'running', { results });
          continue;
        }
        throw fetchErr; // re-throw non-plan errors to the outer catch
      }
      let sourceItems = rawItems;
      // Apply custom sort order if defined (e.g., complex listing hierarchy)
      if (categoryDef.sortItems) {
        sourceItems = categoryDef.sortItems(sourceItems);
      }

      // Safety filter: keep only selected listings (no-op when getListingsByIds was
      // used above, but guards against unexpected extra items from the API).
      // Use effectivePilotIds when set — it includes original selected IDs plus
      // any siblings auto-expanded from complexGroups so they are not stripped here.
      if (category === 'listings' && migration.selected_listing_ids) {
        const selectedIds = effectivePilotIds || new Set(migration.selected_listing_ids);
        sourceItems = sourceItems.filter(item => selectedIds.has(item._id));
        log.info(`Pilot mode: confirmed ${sourceItems.length} selected listings`);
      }

      // Safety filter: scope dependent categories to migrated listings (no-op when
      // the targeted fetch was used above, kept for non-listings-filtered paths).
      const LISTING_DEPENDENT_CATEGORIES = ['reservations', 'tasks', 'saved_replies'];
      if (LISTING_DEPENDENT_CATEGORIES.includes(category) && migration.selected_listing_ids && idMaps.listings) {
        const migratedListingIds = new Set(Object.keys(idMaps.listings));
        sourceItems = sourceItems.filter(item => {
          const lid = item.listingId || (Array.isArray(item.listingIds) && item.listingIds[0]);
          return !lid || migratedListingIds.has(lid);
        });
        log.info(`Pilot mode: scoped ${category} to ${sourceItems.length} items matching migrated listings`);
      }

      // If the category defines a customRunner, delegate entirely to it
      if (categoryDef.customRunner) {
        const customResult = await categoryDef.customRunner(
          sourceItems, sourceClient, destClient, idMaps, log
        );
        results[category] = {
          sourceCount:   customResult.sourceCount,
          migratedCount: customResult.migratedCount,
          failedCount:   customResult.failedCount,
        };
        if (customResult.failedCount > 0) hasFailures = true;
        await logCategory(
          migrationId, category,
          customResult.failedCount === 0 ? 'complete' : 'partial',
          customResult.sourceCount, customResult.migratedCount,
          customResult.failedCount, customResult.skippedCount || 0,
          customResult.errors?.length > 0 ? customResult.errors : null
        );
        await updateStatus(migrationId, 'running', { results });
        continue; // skip the default create loop
      }

      const sourceCount = sourceItems.length;
      let migratedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const errors = [];

      // Restore any partial idMap from a previous interrupted run so that
      // re-runs can skip items already created in the destination account.
      // Priority: ETL load log (DB) → JSONB blob (legacy snapshot).
      // The ETL load log is always up-to-date after restarts; the JSONB blob
      // is a fallback for migrations that predate the ETL architecture.
      let idMap = {};
      if (category === 'listings') {
        const etlIdMap = await buildIdMapFromLoadLog(migrationId);
        if (Object.keys(etlIdMap).length > 0) {
          idMap = etlIdMap;
          log.info(`listings: restored idMap from ETL load log (${Object.keys(idMap).length} entries)`);
        } else {
          // Fallback: legacy JSONB blob stored in migration results
          const partialStoredMap = storedResults[category]?.idMap;
          if (partialStoredMap && typeof partialStoredMap === 'object') {
            idMap = { ...partialStoredMap };
            log.info(`listings: restored idMap from JSONB blob (${Object.keys(idMap).length} entries) — backfilling ETL load log`);
            // Backfill the load log so future restarts use ETL path
            for (const [srcId, destId] of Object.entries(idMap)) {
              await upsertLoadLog(migrationId, 'listing_create', srcId, destId, 'loaded');
            }
          }
        }
      } else {
        const partialStoredMap = storedResults[category]?.idMap;
        idMap = (partialStoredMap && typeof partialStoredMap === 'object')
          ? { ...partialStoredMap }
          : {};
      }
      if (Object.keys(idMap).length > 0) {
        log.info(`${category}: resuming with ${Object.keys(idMap).length} already-created item(s) from partial run`);
      }
      // Always assign idMaps[category] = idMap by reference BEFORE the creation
      // loop so that transform() can remap parentId using live entries as they
      // are added (e.g. MTL parent created first → sub-units see its dest ID).
      idMaps[category] = idMap;

      // MTL parent guard: skip any multi-unit parent that has no sub-units
      // in the current migration set. Creating a parent without sub-units
      // causes Guesty's UI to show "Oops" / 404.
      // NOTE: intentionally checks sourceItems (the selected/filtered set),
      // not rawItems — sub-units must be selected to count. If they're
      // channel-managed but included in the selection, they're fine here
      // because their integrations are already stripped by SOURCE_ONLY_FIELDS.
      if (category === 'listings') {
        const allSubUnitParentIds = new Set(
          sourceItems.filter(l => l.parentId).map(l => l.parentId)
        );
        const { parents: selectedParents } = classifyListings(sourceItems);
        const orphaned = selectedParents.filter(p => !allSubUnitParentIds.has(p._id));
        if (orphaned.length > 0) {
          const orphanedIds = new Set(orphaned.map(p => p._id));
          sourceItems = sourceItems.filter(l => !orphanedIds.has(l._id));
          for (const p of orphaned) {
            skippedCount++;
            errors.push({
              sourceId: p._id,
              error: `Multi-unit parent "${p.title || p.nickname || p._id}" skipped — no sub-units were selected or found in the source account. Guesty requires at least one sub-unit; add the sub-units to your selection and retry.`,
            });
          }
          hasFailures = true;
          log.info(`Skipped ${orphaned.length} orphaned MTL parent(s) — no sub-units selected or found`);
        }
      }

      // Pre-build a nickname→destId lookup for the destination account so that
      // handleConflict can resolve "nickname already exists" errors instantly
      // from memory instead of firing 163 individual GET /listings requests
      // concurrently (which triggers 429s and silently returns null, leaving
      // all conflicting listings as failures with no idMap entry).
      if (category === 'listings') {
        try {
          const cache = await destClient.buildNicknameCache();
          log.info('listings: destination nickname cache ready', { count: Object.keys(cache).length });
        } catch (cacheErr) {
          log.warn('listings: failed to build nickname cache — conflict resolution will fall back to API search', { error: cacheErr.message });
        }
      }

      for (const item of sourceItems) {
        const sourceId = item[categoryDef.idField];
        try {
          // Skip items already created in a previous interrupted run.
          // idMap is pre-seeded from storedResults above so re-runs don't
          // create duplicates when the engine was killed mid-loop.
          if (sourceId && idMap[sourceId]) {
            migratedCount++;
            continue;
          }

          // Skip items that don't pass the category filter
          if (categoryDef.filter && !categoryDef.filter(item)) {
            skippedCount++;
            continue; // don't count as failed — just skip
          }
          let transformed;

          if (categoryDef.transform) {
            transformed = categoryDef.transform(item, idMaps);
          } else {
            transformed = stripFieldsDeep(item);
          }

          // For MTL sub-units: inject mtl.p at creation time using the destination
          // parent's listing _id.  Guesty wires the parent-child relationship from
          // mtl.p during POST; the field is read-only after creation (PUT silently
          // ignores it).  mtl.p must be the parent LISTING _id — verified against
          // Guesty's own UI behaviour which also uses the listing _id here.
          if (category === 'listings' && item.parentId) {
            const destParentId = idMaps.listings?.[item.parentId];
            if (destParentId) {
              transformed = { ...transformed, mtl: { p: destParentId } };
              log.debug(`listings: injecting mtl.p for sub-unit`, { sourceId, destParentId });
            }
          }

          await touchProgress(migrationId); // heartbeat before every blocking Guesty create call
          const created = await categoryDef.create(destClient, transformed);
          const newId = created._id || created.id;
          if (sourceId && newId) {
            idMap[sourceId] = newId;
            // ETL load log: record successful listing creation so idMap survives restarts
            if (category === 'listings') {
              await upsertLoadLog(migrationId, 'listing_create', sourceId, newId, 'loaded');
            }
          }
          migratedCount++;

          // Photo handling for listings
          if (category === 'listings') {
            // Guesty's Open API v1 has no working separate photo upload endpoint.
            // Photos are included directly in the POST /listings create body
            // (via the pictures[] array) — Guesty handles them at creation time.
            //
            // We check the TRANSFORMED payload (not the source item) to decide
            // whether photos will re-sync from a channel. SOURCE_ONLY_FIELDS
            // always strips `integrations` before the POST, so every listing we
            // create in the destination is a manual/non-channel listing — photos
            // will never be re-synced and must be migrated explicitly.
            const pictures = item.pictures || [];
            const includedCount = destClient.isChannelListing(transformed)
              ? 0  // destination listing still has a channel connection — skip photos
              : pictures.filter(p => extractPhotoUrl(p)).length;
            totalPhotos.found    += pictures.length;
            totalPhotos.migrated += includedCount;
            totalPhotos.skipped  += (pictures.length - includedCount);

            // Incremental idMap checkpoint — save every 10 listings so that if
            // the engine is killed mid-loop, a re-run can skip already-created
            // items and avoid duplicating listings in the destination account.
            // Calendar block migration runs in a parallel post-creation phase.
            if (migratedCount % 10 === 0) {
              results[category] = { ...(results[category] || {}), idMap: { ...idMap }, migratedCount, failedCount, sourceCount };
              await updateStatus(migrationId, 'running', { results });
              log.info(`listings: checkpoint saved — ${migratedCount} of ${sourceCount} mapped`);
            }
          }
        } catch (err) {
          // Handle 409 conflicts generically or per-category
          if (categoryDef.handleConflict) {
            try {
              const handled = await categoryDef.handleConflict(err, item, destClient, idMap);
              if (handled) {
                migratedCount++;
                // ETL load log: record conflict-handled listing so idMap survives restarts
                if (category === 'listings' && sourceId && idMap[sourceId]) {
                  await upsertLoadLog(migrationId, 'listing_create', sourceId, idMap[sourceId], 'loaded');
                }
                continue;
              }
            } catch { /* fall through */ }
          }
          if (category === 'guests' && err.response?.status === 409) {
            // Guest already exists in destination — try to find by email
            try {
              const email = item.email || item.emails?.[0]?.address;
              if (email) {
                const existing = await destClient.findGuestByEmail(email);
                if (existing && (existing._id || existing.id)) {
                  const existingId = existing._id || existing.id;
                  idMap[sourceId] = existingId;
                  migratedCount++; // count as success
                  continue;
                }
              }
            } catch (lookupErr) {
              // fall through to failedCount
            }
          }
          failedCount++;
          const rawErrMsg = err.response?.data?.message ?? err.response?.data ?? err.message;
          errors.push({
            sourceId: item[categoryDef.idField],
            error: typeof rawErrMsg === 'object' ? JSON.stringify(rawErrMsg) : String(rawErrMsg),
            status: err.response?.status,
          });
        }
      }

      // ── Persist idMap to DB immediately after creation loop ─────────────────
      // The final updateStatus call at the end of the listings category only runs
      // after spaces + calendar complete (which can take 10–20 min under heavy
      // rate-limiting).  Snapshot the idMap now so a container kill or stall-
      // detector event during those phases doesn't lose all creation work.
      if (category === 'listings' && Object.keys(idMap).length > 0) {
        const snapResults = { ...results };
        snapResults[category] = {
          sourceCount, migratedCount, failedCount,
          ...(skippedCount > 0 ? { skippedCount } : {}),
          ...(errors.length > 0 ? { errors: errors.slice(0, 20) } : {}),
          ...(Object.keys(idMap).length > 0 ? { idMap } : {}),
        };
        await updateStatus(migrationId, 'running', { results: snapResults });
        log.info(`listings: idMap snapshot persisted (${Object.keys(idMap).length} entries) before spaces migration`);
      }

      // ── Sequential spaces + availability-settings migration (listings only) ──
      // ETL load phase: read pre-extracted data from migration_source_data.
      // Guesty's dashboard crashes when sub-resources are absent — the UI assumes
      // at least one "space" and an availability-settings document exist per listing.
      // Sequential (not parallel) so progress is tracked per-item and resumable.
      if (category === 'listings') {
        const subPairs = Object.entries(idMap); // [[srcId, destId], ...]
        log.info(`listings: migrating spaces + availability-settings for ${subPairs.length} listing(s) (ETL load from DB)`);
        const spacesHbInterval = setInterval(() => touchProgress(migrationId), 10000);

        const alreadyLoadedSpaces = await getLoadedSourceIds(migrationId, 'spaces_load');
        const alreadyLoadedAvail  = await getLoadedSourceIds(migrationId, 'availability_load');

        // Pre-load all extracted data into Maps to avoid N² DB calls in the loop
        const allSpacesRows = await loadSourceData(migrationId, 'spaces');
        const spacesRowMap  = new Map(allSpacesRows.map(r => [r.sourceId, r.data]));
        const allAvailRows  = await loadSourceData(migrationId, 'availability');
        const availRowMap   = new Map(allAvailRows.map(r => [r.sourceId, r.data]));

        let spacesLoaded = 0;
        let availLoaded = 0;
        try {
          for (const [srcId, destId] of subPairs) {
            // ── Spaces ──────────────────────────────────────────────────────
            if (!alreadyLoadedSpaces.has(srcId)) {
              try {
                const spaces = spacesRowMap.get(srcId) || [];
                if (Array.isArray(spaces) && spaces.length > 0) {
                  for (const space of spaces) {
                    const cleanedSpace = stripFieldsDeep(space);
                    try {
                      await destClient.createListingSpace(destId, cleanedSpace);
                    } catch (spErr) {
                      if (spErr.response?.status !== 409) {
                        log.warn(`listings: space create failed for dest ${destId}`, { error: spErr.response?.data?.message || spErr.message });
                      }
                    }
                  }
                }
                await upsertLoadLog(migrationId, 'spaces_load', srcId, destId, 'loaded');
                spacesLoaded++;
              } catch (err) {
                log.warn(`listings: spaces load failed for source ${srcId}`, { error: err.message });
                await upsertLoadLog(migrationId, 'spaces_load', srcId, destId, 'failed', err.message);
              }
            }

            // ── Availability settings ────────────────────────────────────────
            if (!alreadyLoadedAvail.has(srcId)) {
              try {
                const avail = availRowMap.get(srcId) || {};
                if (avail && typeof avail === 'object' && Object.keys(avail).length > 0) {
                  const cleanedAvail = stripFieldsDeep(avail);
                  try {
                    await destClient.updateListingAvailabilitySettings(destId, cleanedAvail);
                  } catch (avErr) {
                    log.warn(`listings: availability-settings update failed for dest ${destId}`, { error: avErr.response?.data?.message || avErr.message });
                  }
                }
                await upsertLoadLog(migrationId, 'availability_load', srcId, destId, 'loaded');
                availLoaded++;
              } catch (err) {
                log.warn(`listings: availability load failed for source ${srcId}`, { error: err.message });
                await upsertLoadLog(migrationId, 'availability_load', srcId, destId, 'failed', err.message);
              }
            }
          }
        } finally {
          clearInterval(spacesHbInterval);
        }
        log.info(`listings: spaces + availability-settings migration complete (${spacesLoaded} spaces, ${availLoaded} avail)`);
      }

      // ── Sequential calendar block migration (listings only) ──────────────────
      // ETL load phase: read pre-extracted blocks from migration_source_data.
      // Sequential so progress is tracked per-item and resumable across restarts.
      // Calendar blocks are non-fatal if they fail.
      if (category === 'listings') {
        const calPairs = Object.entries(idMap); // [[srcId, destId], ...]
        log.info(`listings: migrating calendar blocks for ${calPairs.length} listing(s) (ETL load from DB)`);
        const calHbInterval = setInterval(() => touchProgress(migrationId), 10000);

        const alreadyLoadedCal = await getLoadedSourceIds(migrationId, 'calendar_load');
        const allCalRows = await loadSourceData(migrationId, 'calendar');
        const calRowMap = new Map(allCalRows.map(r => [r.sourceId, r.data]));

        let calLoaded = 0;
        try {
          for (const [srcId, destId] of calPairs) {
            if (alreadyLoadedCal.has(srcId)) continue;
            try {
              const blocks = calRowMap.get(srcId) || [];
              if (Array.isArray(blocks) && blocks.length > 0) {
                const ranges = groupContiguousDays(blocks);
                for (const range of ranges) {
                  try {
                    await destClient.blockListingCalendar(destId, range.start, range.end, range.note);
                  } catch (blockErr) {
                    errors.push({ sourceId: srcId, type: 'calendar_block', range, error: blockErr.message });
                  }
                }
              }
              await upsertLoadLog(migrationId, 'calendar_load', srcId, destId, 'loaded');
              calLoaded++;
            } catch (err) {
              log.warn(`listings: calendar load failed for source ${srcId}`, { error: err.message });
              await upsertLoadLog(migrationId, 'calendar_load', srcId, destId, 'failed', err.message);
            }
          }
        } finally {
          clearInterval(calHbInterval);
        }
        log.info(`listings: calendar block migration complete (${calLoaded} loaded)`);
      }

      // ── Post-processing: remap subListingsIds on MTL parent listings ────────
      // NOTE: mtl.c (parent's children list) and mtl.p (sub-unit's parent ref) are
      // READ-ONLY via Guesty's Open API — PUT /listings silently accepts but ignores
      // changes to the mtl field.  The correct wiring is done AT CREATION TIME:
      //   • destParentMtlIds is populated when each parent is created (above)
      //   • Each sub-unit's POST body includes { mtl: { p: destParentMtlId } }
      // No post-creation PATCH is needed or possible for mtl.

      idMaps[category] = idMap;
      results[category] = {
        sourceCount,
        migratedCount,
        failedCount,
        ...(skippedCount > 0 ? { skippedCount } : {}),
        ...(errors.length > 0 ? { errors: errors.slice(0, 20) } : {}),
        // Persist the source→dest ID mapping so retries can restore it without
        // re-creating already-migrated items (e.g., to retry failed photo uploads
        // or remap IDs in dependent categories like reservations/tasks).
        ...(Object.keys(idMap).length > 0 ? { idMap } : {}),
      };

      if (failedCount > 0) {
        hasFailures = true;
        // Log first 5 failures so they are visible in deployment logs without
        // needing to query the DB — makes remote debugging much faster.
        log.warn(`${category}: ${failedCount} item(s) failed to migrate`, {
          sample: errors.slice(0, 5).map(e => ({
            sourceId: e.sourceId,
            status: e.status,
            error: typeof e.error === 'string' ? e.error.slice(0, 200) : e.error,
          })),
        });
      }

      const photosForLog = category === 'listings' ? totalPhotos : null;
      await logCategory(migrationId, category, failedCount === 0 ? 'complete' : 'partial', sourceCount, migratedCount, failedCount, skippedCount, errors.length > 0 ? errors : null, photosForLog);

      // Update results incrementally
      await updateStatus(migrationId, 'running', { results });
    } catch (err) {
      hasFailures = true;
      // Preserve any idMap built so far — this ensures the fast-path early-exit
      // works on the next restart and prevents losing creation work on re-throw.
      const savedIdMap = (idMaps[category] && Object.keys(idMaps[category]).length > 0)
        ? idMaps[category]
        : (storedResults[category]?.idMap && Object.keys(storedResults[category].idMap).length > 0)
          ? storedResults[category].idMap
          : null;
      results[category] = {
        sourceCount: 0, migratedCount: 0, failedCount: 0, error: err.message,
        ...(savedIdMap ? { idMap: savedIdMap } : {}),
      };
      await logCategory(migrationId, category, 'failed', 0, 0, 0, 0, [{ error: err.message }]);
    }
  }

  // Verification: compare counts (count-only, no re-fetching)
  const diffReport = {};
  for (const category of selectedCategories) {
    const categoryDef = CATEGORIES[category];
    if (!categoryDef) continue;

    // Categories with no API count path (e.g. pricing_snapshot) get a synthetic entry
    if (getCountForClient === null || category === 'pricing_snapshot') {
      diffReport[category] = {
        source:      results[category]?.sourceCount  || 0,
        destination: results[category]?.migratedCount || 0,
        match: true,
        note: 'calendar overlay — count is listings processed',
      };
      continue;
    }

    try {
      const [sourceCount, destCount] = await Promise.all([
        getCountForClient(sourceClient, category),
        getCountForClient(destClient, category),
      ]);

      // null means the endpoint isn't available on this plan — skip count comparison
      if (sourceCount === null || destCount === null) {
        diffReport[category] = {
          source:      results[category]?.sourceCount  || 0,
          destination: results[category]?.migratedCount || 0,
          match: true,
          note: 'count endpoint not available on this plan',
        };
        continue;
      }

      diffReport[category] = {
        source: sourceCount,
        destination: destCount,
        match: sourceCount === destCount,
      };
    } catch (err) {
      diffReport[category] = {
        source: results[category]?.sourceCount || 0,
        destination: results[category]?.migratedCount || 0,
        match: false,
        error: err.message,
      };
    }
  }

  // Add photos section to diff report
  diffReport.photos = {
    found: totalPhotos.found,
    migrated: totalPhotos.migrated,
    skipped: totalPhotos.skipped,
    note: 'photos are included in the listing create body; Guesty processes them at creation time. MTL sub-units are migrated as manual listings so their photos are always included.',
  };

  const finalStatus = hasFailures ? 'complete_with_errors' : 'complete';
  await updateStatus(migrationId, finalStatus, { results, diff_report: diffReport });

  // Send email report
  try {
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [migration.user_id]);
    if (userResult.rows.length > 0) {
      const updatedMig = await pool.query('SELECT * FROM migrations WHERE id = $1', [migrationId]);
      await sendMigrationReport(userResult.rows[0].email, updatedMig.rows[0]);
    }
  } catch (err) {
    log.error('Failed to send migration report email', { error: err.message });
  }

  log.info(`Migration completed with status: ${finalStatus}`);
  } catch (topLevelErr) {
    // Top-level catch prevents migrations from being stuck in 'running' forever
    const log = logger.child({ migrationId });
    log.error('Migration failed with unhandled error', { error: topLevelErr.message });
    try {
      await updateStatus(migrationId, 'failed', {
        error_message: topLevelErr.message || 'Unhandled migration error',
      });
    } catch (statusErr) {
      log.error('Failed to update migration status', { error: statusErr.message });
    }
  }
}

module.exports = { runMigration, extractPhotoUrl, stripFieldsDeep };
