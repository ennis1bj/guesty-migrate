const { pool } = require('./db');
const { decrypt } = require('./encryption');
const GuestyClient = require('./guestyClient');
const { sendMigrationReport } = require('./email');

const STRIP_FIELDS = ['_id', 'accountId', 'createdAt', 'updatedAt', 'channelListingId', 'importedAt'];

function stripFields(obj) {
  const cleaned = { ...obj };
  for (const field of STRIP_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}

const CATEGORIES = {
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
  },
  reservations: {
    getAll: (client) => client.getAllReservations(),
    create: (client, data) => client.createReservation(data),
    idField: '_id',
    transform: (item, maps) => {
      const cleaned = stripFields(item);
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
  },
  tasks: {
    getAll: (client) => client.getAllTasks(),
    create: (client, data) => client.createTask(data),
    idField: '_id',
    transform: (item, maps) => {
      const cleaned = stripFields(item);
      if (cleaned.listingId && maps.listings) {
        cleaned.listingId = maps.listings[cleaned.listingId] || cleaned.listingId;
      }
      return cleaned;
    },
  },
};

// Strict migration order for dependency resolution
const MIGRATION_ORDER = ['listings', 'guests', 'owners', 'reservations', 'automations', 'tasks'];

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

async function logCategory(migrationId, category, status, sourceCount, migratedCount, failedCount, errorDetails) {
  await pool.query(
    `INSERT INTO migration_logs (migration_id, category, status, source_count, migrated_count, failed_count, error_details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [migrationId, category, status, sourceCount, migratedCount, failedCount, errorDetails ? JSON.stringify(errorDetails) : null]
  );
}

async function runMigration(migrationId) {
  const migResult = await pool.query('SELECT * FROM migrations WHERE id = $1', [migrationId]);
  if (migResult.rows.length === 0) throw new Error(`Migration ${migrationId} not found`);

  const migration = migResult.rows[0];

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

  for (const category of MIGRATION_ORDER) {
    if (!selectedCategories.includes(category)) continue;

    const categoryDef = CATEGORIES[category];
    if (!categoryDef) continue;

    try {
      console.log(`Migrating ${category}...`);
      const sourceItems = await categoryDef.getAll(sourceClient);
      const sourceCount = sourceItems.length;
      let migratedCount = 0;
      let failedCount = 0;
      const errors = [];
      const idMap = {};

      for (const item of sourceItems) {
        try {
          const sourceId = item[categoryDef.idField];
          let transformed;

          if (categoryDef.transform) {
            transformed = categoryDef.transform(item, idMaps);
          } else {
            transformed = stripFields(item);
          }

          const created = await categoryDef.create(destClient, transformed);
          const newId = created._id || created.id;
          if (sourceId && newId) {
            idMap[sourceId] = newId;
          }
          migratedCount++;
        } catch (err) {
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

      await logCategory(migrationId, category, failedCount === 0 ? 'complete' : 'partial', sourceCount, migratedCount, failedCount, errors.length > 0 ? errors : null);

      // Update results incrementally
      await updateStatus(migrationId, 'running', { results });
    } catch (err) {
      hasFailures = true;
      results[category] = { sourceCount: 0, migratedCount: 0, failedCount: 0, error: err.message };
      await logCategory(migrationId, category, 'failed', 0, 0, 0, [{ error: err.message }]);
    }
  }

  // Verification: compare counts
  const diffReport = {};
  for (const category of selectedCategories) {
    const categoryDef = CATEGORIES[category];
    if (!categoryDef) continue;

    try {
      const sourceItems = await categoryDef.getAll(sourceClient);
      const destItems = await categoryDef.getAll(destClient);
      diffReport[category] = {
        source: sourceItems.length,
        destination: destItems.length,
        match: sourceItems.length === destItems.length,
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
