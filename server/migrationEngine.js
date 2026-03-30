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
    listings:      '/listings',
    guests:        '/guests',
    owners:        '/owners',
    saved_replies: '/saved-replies',
    reservations:  '/reservations',
    tasks:         '/tasks-open-api/tasks?columns=_id',
  };
  return paths[category] || `/${category}`;
}

// Returns the correct count for a category, resolving account-ID-dependent
// or param-required paths that cannot be expressed as a plain static path.
async function getCountForClient(client, category) {
  if (category === 'custom_fields') {
    const id = await client.getAccountId();
    return client.getCount(`/accounts/${id}/custom-fields`);
  }
  if (category === 'fees') return client.getCount('/additional-fees/account');
  if (category === 'tasks') return client.getCount('/tasks-open-api/tasks?columns=_id');
  return client.getCount(getCategoryPath(category));
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
    getAll: (client) => client.getAllCustomFields(),
    create: (client, data) => client.createCustomField(data),
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
     * Custom ordering: standalone first, then parents, then sub-units.
     * This ensures parentId can be remapped for sub-units.
     */
    sortItems: (items) => {
      const { standalone, parents, subUnits } = classifyListings(items);
      return [...standalone, ...parents, ...subUnits];
    },
    transform: (item, maps) => {
      const cleaned = stripFieldsDeep(item);
      // Remap parentId for sub-units (complex listing children)
      if (cleaned.parentId && maps.listings) {
        cleaned.parentId = maps.listings[cleaned.parentId] || cleaned.parentId;
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
};

// Strict migration order for dependency resolution
const MIGRATION_ORDER = [
  'custom_fields',
  'fees',
  'listings',
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
  const result = await pool.query(
    `SELECT category, migrated_count FROM migration_logs
     WHERE migration_id = $1 ORDER BY created_at ASC`,
    [migrationId]
  );
  // Returns map of category -> already migrated count
  const prev = {};
  for (const row of result.rows) {
    prev[row.category] = row.migrated_count || 0;
  }
  return prev;
}

async function runMigration(migrationId) {
  const log = logger.child({ migrationId });
  try {
  const migResult = await pool.query('SELECT * FROM migrations WHERE id = $1', [migrationId]);
  if (migResult.rows.length === 0) throw new Error(`Migration ${migrationId} not found`);

  const migration = migResult.rows[0];

  const previousResults = await loadPreviousResults(migrationId);

  await updateStatus(migrationId, 'running');

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
  const totalPhotos = { found: 0, migrated: 0, skipped: 0, failed: 0 };

  for (const category of MIGRATION_ORDER) {
    if (!selectedCategories.includes(category)) continue;

    const categoryDef = CATEGORIES[category];
    if (!categoryDef) continue;

    // Skip categories that already completed successfully in a prior run
    if (previousResults[category] > 0) {
      log.info(`Skipping ${category} — already migrated in prior run`, { count: previousResults[category] });
      continue;
    }

    try {
      log.info(`Migrating ${category}...`);
      let rawItems;
      try {
        rawItems = await categoryDef.getAll(sourceClient);
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

      // Pilot mode: filter listings by selected IDs
      if (category === 'listings' && migration.selected_listing_ids) {
        const selectedIds = new Set(migration.selected_listing_ids);
        sourceItems = sourceItems.filter(item => selectedIds.has(item._id));
        log.info(`Pilot mode: filtered to ${sourceItems.length} selected listings`);
      }

      // Pilot mode: scope dependent categories to migrated listings
      const LISTING_DEPENDENT_CATEGORIES = ['reservations', 'tasks', 'saved_replies'];
      if (LISTING_DEPENDENT_CATEGORIES.includes(category) && migration.selected_listing_ids && idMaps.listings) {
        const migratedListingIds = new Set(Object.keys(idMaps.listings));
        sourceItems = sourceItems.filter(item => {
          const lid = item.listingId || (Array.isArray(item.listingIds) && item.listingIds[0]);
          return !lid || migratedListingIds.has(lid);
        });
        log.info(`Pilot mode: scoped ${category} to ${sourceItems.length} items matching migrated listings`);
      }

      const sourceCount = sourceItems.length;
      let migratedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const errors = [];
      const idMap = {};

      for (const item of sourceItems) {
        const sourceId = item[categoryDef.idField];
        try {
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

          // Photo migration for listings
          if (category === 'listings') {
            const photoStats = { found: 0, migrated: 0, skipped: 0, failed: 0 };

            if (destClient.isChannelListing(item)) {
              // Skip — channel will re-sync photos on reconnect
              photoStats.skipped = (item.pictures || []).length;
            } else {
              const pictures = item.pictures || [];
              photoStats.found = pictures.length;
              for (const pic of pictures) {
                const photoUrl = extractPhotoUrl(pic);
                if (!photoUrl) {
                  photoStats.skipped++;
                  continue;
                }
                try {
                  await destClient.uploadListingPhoto(newId, photoUrl);
                  photoStats.migrated++;
                } catch (photoErr) {
                  photoStats.failed++;
                  errors.push({
                    sourceId: item[categoryDef.idField],
                    photoUrl,
                    error: photoErr.response?.data?.message || photoErr.message,
                  });
                }
              }
            }

            totalPhotos.found += photoStats.found;
            totalPhotos.migrated += photoStats.migrated;
            totalPhotos.skipped += photoStats.skipped;
            totalPhotos.failed += photoStats.failed;

            // Calendar block migration
            try {
              const blocks = await sourceClient.getListingCalendarBlocks(sourceId);
              if (blocks.length > 0) {
                const ranges = groupContiguousDays(blocks);
                for (const range of ranges) {
                  try {
                    await destClient.blockListingCalendar(newId, range.start, range.end, range.note);
                  } catch (blockErr) {
                    // Non-fatal — log but continue
                    errors.push({
                      sourceId,
                      type: 'calendar_block',
                      range,
                      error: blockErr.message,
                    });
                  }
                }
              }
            } catch (calErr) {
              // Non-fatal
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
          errors.push({
            sourceId: item[categoryDef.idField],
            error: err.response?.data?.message || err.message,
          });
        }
      }

      idMaps[category] = idMap;
      results[category] = { sourceCount, migratedCount, failedCount };

      if (failedCount > 0) hasFailures = true;

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

    try {
      const [sourceCount, destCount] = await Promise.all([
        getCountForClient(sourceClient, category),
        getCountForClient(destClient, category),
      ]);
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
    skipped_channel_managed: totalPhotos.skipped,
    failed: totalPhotos.failed,
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
