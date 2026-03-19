const { pool } = require('./db');
const { decrypt } = require('./encryption');
const GuestyClient = require('./guestyClient');
const { sendMigrationReport } = require('./email');

function getCategoryPath(category) {
  const paths = {
    custom_fields: '/custom-fields',
    listings:      '/listings',
    reservations:  '/reservations',
    guests:        '/guests',
    owners:        '/owners',
    automations:   '/automations',
    tasks:         '/tasks-open-api/tasks',
    fees:          '/fees',
    taxes:         '/taxes',
  };
  return paths[category] || `/${category}`;
}

const SOURCE_ONLY_FIELDS = new Set([
  '_id', 'accountId', 'createdAt', 'updatedAt',
  'channelListingId', 'importedAt', 'integrations',
  'id',
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
  taxes: {
    getAll: (client) => client.getAllTaxes(),
    create: (client, data) => client.createTax(data),
    idField: '_id',
  },
  listings: {
    getAll: (client) => client.getAllListings(),
    create: (client, data) => client.createListing(data),
    idField: '_id',
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
  automations: {
    getAll: (client) => client.getAllAutomations(),
    create: (client, data) => client.createAutomation(data),
    idField: '_id',
    transform: (item, maps) => {
      const cleaned = stripFieldsDeep(item);
      // Remap top-level listingId
      if (cleaned.listingId && maps.listings) {
        cleaned.listingId = maps.listings[cleaned.listingId] || cleaned.listingId;
      }
      // Remap listingIds array if present
      if (Array.isArray(cleaned.listingIds) && maps.listings) {
        cleaned.listingIds = cleaned.listingIds.map(
          id => maps.listings[id] || id
        );
      }
      // Remap conditions array entries that reference listingId
      if (Array.isArray(cleaned.conditions)) {
        cleaned.conditions = cleaned.conditions.map(cond => {
          if (cond.listingId && maps.listings) {
            return { ...cond, listingId: maps.listings[cond.listingId] || cond.listingId };
          }
          return cond;
        });
      }
      return cleaned;
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
const MIGRATION_ORDER = ['custom_fields', 'fees', 'taxes', 'listings', 'guests', 'owners', 'reservations', 'automations', 'tasks'];

async function updateStatus(migrationId, status, extra = {}) {
  const sets = ['status = $2'];
  const values = [migrationId, status];
  let idx = 3;

  for (const [key, value] of Object.entries(extra)) {
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
  const migResult = await pool.query('SELECT * FROM migrations WHERE id = $1', [migrationId]);
  if (migResult.rows.length === 0) throw new Error(`Migration ${migrationId} not found`);

  const migration = migResult.rows[0];

  const previousResults = await loadPreviousResults(migrationId);

  await updateStatus(migrationId, 'running');

  const sourceClient = new GuestyClient({
    clientId: migration.source_client_id,
    clientSecret: decrypt(migration.source_client_secret),
  });

  const destClient = new GuestyClient({
    clientId: migration.dest_client_id,
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
      console.log(`Skipping ${category} — already migrated in prior run (${previousResults[category]} items)`);
      continue;
    }

    try {
      console.log(`Migrating ${category}...`);
      const sourceItems = await categoryDef.getAll(sourceClient);
      const sourceCount = sourceItems.length;
      let migratedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const errors = [];
      const idMap = {};

      for (const item of sourceItems) {
        try {
          // Skip items that don't pass the category filter
          if (categoryDef.filter && !categoryDef.filter(item)) {
            skippedCount++;
            continue; // don't count as failed — just skip
          }

          const sourceId = item[categoryDef.idField];
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
              for (const photoUrl of pictures) {
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
          }
        } catch (err) {
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
      const sourcePath = getCategoryPath(category);
      const destPath   = getCategoryPath(category);
      const [sourceCount, destCount] = await Promise.all([
        sourceClient.getCount(sourcePath),
        destClient.getCount(destPath),
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
    console.error('Failed to send migration report email:', err.message);
  }

  console.log(`Migration ${migrationId} completed with status: ${finalStatus}`);
}

module.exports = { runMigration };
