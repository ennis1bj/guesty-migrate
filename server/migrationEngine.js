const { pool } = require('./db');
const { decrypt } = require('./encryption');
const GuestyClient = require('./guestyClient');
const { sendMigrationReport } = require('./email');
const { logger } = require('./logger');

function extractPhotoUrl(pic) {
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
  try {
    await pool.query(
      `UPDATE migrations SET last_progress_at = NOW() WHERE id = $1`,
      [migrationId]
    );
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

        if (category === 'listings' && pilotListingIds?.length) {
          // Fetch each selected listing directly by ID in parallel.
          // Replaces getAllListings() which pages through every listing on the account.
          await touchProgress(migrationId);
          rawItems = await sourceClient.getListingsByIds(pilotListingIds);
          log.info(`Pilot: fetched ${rawItems.length}/${pilotListingIds.length} listings by ID`);

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
                  await touchProgress(migrationId);
                  const orphanedFull = await sourceClient.getListingsByIds(orphanedIds);
                  for (const ol of orphanedFull) {
                    const cId = ol.complexId || ol.parentId;
                    if (cId && wantedComplexIds.has(cId) && !seenIds.has(ol._id)) {
                      missingIds.add(ol._id);
                      seenIds.add(ol._id);
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
            const mtlListings = rawItems.filter(
              r => r.type === 'MTL' || r.listingType === 'MTL' ||
                   (Array.isArray(r.subListingsIds) && r.subListingsIds.length > 0)
            );
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
            const siblings = await sourceClient.getListingsByIds([...missingIds]);

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

        } else if (category === 'reservations' && pilotListingIds && migratedSrcIds.length) {
          // Fetch reservations only for the listings that were actually migrated.
          rawItems = await sourceClient.getReservationsByListingIds(migratedSrcIds);
          log.info(`Pilot: fetched ${rawItems.length} reservations for ${migratedSrcIds.length} listing(s)`);

        } else if (category === 'tasks' && pilotListingIds && migratedSrcIds.length) {
          // Fetch tasks only for the listings that were actually migrated.
          rawItems = await sourceClient.getTasksByListingIds(migratedSrcIds);
          log.info(`Pilot: fetched ${rawItems.length} tasks for ${migratedSrcIds.length} listing(s)`);

        } else {
          // Full-account fetch for non-pilot migrations and account-level categories
          // (fees, owners, guests, saved_replies, rate_strategies, custom_fields).
          await touchProgress(migrationId);
          rawItems = categoryDef.getAll
            ? await categoryDef.getAll(sourceClient)
            : [];
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
      const partialStoredMap = storedResults[category]?.idMap;
      const idMap = (partialStoredMap && typeof partialStoredMap === 'object')
        ? { ...partialStoredMap }
        : {};
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

          const created = await categoryDef.create(destClient, transformed);
          const newId = created._id || created.id;
          if (sourceId && newId) {
            idMap[sourceId] = newId;
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
              results[category] = { ...(results[category] || {}), idMap: { ...idMap } };
              await updateStatus(migrationId, 'running', { results });
              log.info(`listings: checkpoint saved — ${migratedCount} of ${sourceCount} mapped`);
            }
          }
        } catch (err) {
          // Handle 409 conflicts generically or per-category
          if (categoryDef.handleConflict) {
            try {
              const handled = await categoryDef.handleConflict(err, item, destClient, idMap);
              if (handled) { migratedCount++; continue; }
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

      // ── Parallel calendar block migration (listings only) ─────────────────
      // Runs after the creation loop so every parent and sub-unit ID is in
      // idMap before we start.  Uses Promise.allSettled so one failure doesn't
      // cancel the rest.  The semaphore in guestyClient caps at 5 concurrent
      // Guesty API calls; calendar blocks are non-fatal if they fail.
      if (category === 'listings') {
        const calPairs = Object.entries(idMap); // [[srcId, destId], ...]
        log.info(`listings: migrating calendar blocks for ${calPairs.length} listing(s) in parallel`);
        await Promise.allSettled(
          calPairs.map(async ([srcId, destId]) => {
            try {
              const blocks = await sourceClient.getListingCalendarBlocks(srcId);
              if (!blocks.length) return;
              const ranges = groupContiguousDays(blocks);
              for (const range of ranges) {
                try {
                  await destClient.blockListingCalendar(destId, range.start, range.end, range.note);
                } catch (blockErr) {
                  errors.push({ sourceId: srcId, type: 'calendar_block', range, error: blockErr.message });
                }
              }
            } catch { /* Non-fatal — listing was created, calendar blocks best-effort */ }
          })
        );
        log.info(`listings: calendar block migration complete`);
      }

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
      results[category] = { sourceCount: 0, migratedCount: 0, failedCount: 0, error: err.message };
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

module.exports = { runMigration, extractPhotoUrl };
