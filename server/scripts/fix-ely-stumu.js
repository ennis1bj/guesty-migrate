/**
 * One-off remediation script — Ely-StuMU orphaned sub-units
 *
 * What this does:
 *  1. Loads migration 2014a96a from the DB and decrypts the destination credentials
 *  2. Deletes the 25 orphaned standalone listings from the destination Guesty account
 *     (sub-units created without mtl.p due to the retry-resume bug)
 *  3. Removes those 25 source IDs from the migration's idMap so the re-run will
 *     recreate them correctly with the mtl.p fix now in place
 *  4. Sets the migration status back to 'paid' — the production server's recovery
 *     loop picks this up within 5 minutes and re-enqueues it automatically
 *
 * Run with:
 *   NODE_ENV=production node server/scripts/fix-ely-stumu.js
 */

require('dotenv').config();
const { pool } = require('../db');
const { decrypt } = require('../encryption');
const GuestyClient = require('../guestyClient');
const { logger } = require('../logger');

const MIGRATION_ID = '2014a96a-386b-46fb-b49c-2d09d843f4c2';

// Source IDs of the 25 orphaned Ely-StuMU sub-units
const ORPHANED_SOURCE_IDS = [
  '66a28514a4635b0012c7a831', '66a28514a4635b0012c7a962', '66a28514a4635b0012c7aa56',
  '66a28514a4635b0012c7a7f4', '66a28514a4635b0012c7a8e8', '66a28514a4635b0012c7a77a',
  '66a28514a4635b0012c7a700', '66a28514a4635b0012c7a8ab', '66a28514a4635b0012c7ac3e',
  '66a28514a4635b0012c7a9dc', '66a28514a4635b0012c7aa19', '66a28514a4635b0012c7a6c3',
  '66a28514a4635b0012c7a925', '66a28514a4635b0012c7a73d', '66a28514a4635b0012c7a86e',
  '66a28514a4635b0012c7ab0d', '66a28514a4635b0012c7a99f', '66a28514a4635b0012c7aad0',
  '66a28514a4635b0012c7a7b7', '66a28514a4635b0012c7ac7b', '66a28514a4635b0012c7ac01',
  '66a28514a4635b0012c7ab87', '66a28514a4635b0012c7ab4a', '66a28514a4635b0012c7aa93',
  '66a28514a4635b0012c7abc4',
];

// Corresponding destination IDs (from the migration idMap — verified via DB query)
const ORPHANED_DEST_IDS = [
  '69cc693ef6741a00140c37c2', '69cc695d94f93000125caeda', '69cc6925948bc90014619b5c',
  '69cc693c94f93000125c96e6', '69cc693594f93000125c8e7e', '69cc693745c753001487d7ca',
  '69cc69629d360e00151479a9', '69cc69225cd95f001398e6c6', '69cc696ba5e1c30014737c85',
  '69cc695245c753001487e2a0', '69cc6927eb8e10001467e91d', '69cc695594f93000125ca8e7',
  '69cc696094f93000125cb8f7', '69cc693c94f93000125c92ba', '69cc695a9d360e001514750c',
  '69cc696809893600140eea62', '69cc695f94f93000125cb313', '69cc695779e0a500132c6ff1',
  '69cc695b08f5b10015eb9f5c', '69cc69650020cc0010b9ff8b', '69cc694994f93000125ca42a',
  '69cc69648e73c900138d0579', '69cc6967a5e1c300147373c1', '69cc694b978e890010d1a358',
  '69cc6963419f9c0011b5369c',
];

async function main() {
  logger.info('=== Ely-StuMU remediation starting ===', { migrationId: MIGRATION_ID });

  // ── 1. Load migration and decrypt destination credentials ─────────────────
  const { rows } = await pool.query(
    'SELECT dest_client_id, dest_client_secret, results, status, retry_count FROM migrations WHERE id = $1',
    [MIGRATION_ID]
  );
  if (rows.length === 0) throw new Error(`Migration ${MIGRATION_ID} not found`);

  const { dest_client_id, dest_client_secret, results, status, retry_count } = rows[0];
  logger.info(`Migration status: ${status}, retry_count: ${retry_count}`);

  const clientId = decrypt(dest_client_id);
  const clientSecret = decrypt(dest_client_secret);
  logger.info('Credentials decrypted — connecting to destination Guesty account');

  const destClient = new GuestyClient({ clientId, clientSecret });

  // ── 2. Verify and delete each orphaned listing from the destination account ──
  let deleted = 0;
  let deleteErrors = 0;

  for (let i = 0; i < ORPHANED_DEST_IDS.length; i++) {
    const destId = ORPHANED_DEST_IDS[i];
    const sourceId = ORPHANED_SOURCE_IDS[i];
    try {
      // Verify it exists before deleting — log the title/type so we can confirm
      // these are the correct orphaned sub-units (should have no parentId)
      const listing = await destClient.request('GET', `/listings/${destId}`);
      logger.info(`About to delete`, {
        destId,
        sourceId,
        title: listing.title || '(no title)',
        type: listing.type,
        parentId: listing.parentId || 'none (orphaned — expected)',
      });

      await destClient.request('DELETE', `/listings/${destId}`);
      deleted++;
      logger.info(`Deleted ${deleted}/${ORPHANED_DEST_IDS.length}`, { destId });
    } catch (err) {
      if (err.response?.status === 404) {
        logger.warn(`Listing not found (already deleted?) — treating as handled`, { destId });
        deleted++;
      } else {
        logger.error(`Failed to delete listing`, { destId, error: err.message });
        deleteErrors++;
      }
    }
  }

  if (deleteErrors > 0) {
    throw new Error(
      `${deleteErrors} listing(s) could not be deleted. Aborting — DB not changed. ` +
      `Investigate the errors above, then re-run.`
    );
  }
  logger.info(`Deleted ${deleted} orphaned listings from destination Guesty account`);

  // ── 3. Remove orphaned source IDs from the migration's idMap ─────────────
  const currentIdMap = results?.listings?.idMap || {};
  const orphanedSet = new Set(ORPHANED_SOURCE_IDS);
  const updatedIdMap = Object.fromEntries(
    Object.entries(currentIdMap).filter(([sid]) => !orphanedSet.has(sid))
  );
  const removedFromMap = Object.keys(currentIdMap).length - Object.keys(updatedIdMap).length;
  logger.info(`idMap: removed ${removedFromMap} source IDs`, {
    before: Object.keys(currentIdMap).length,
    after: Object.keys(updatedIdMap).length,
  });

  const updatedResults = {
    ...results,
    listings: {
      ...results.listings,
      idMap: updatedIdMap,
      // Adjust the migratedCount so progress is accurate on re-run
      migratedCount: (results?.listings?.migratedCount || 0) - removedFromMap,
    },
  };

  // ── 4. Reset migration status to 'paid' ───────────────────────────────────
  // The production server's recovery loop (runs every 5 min) picks up 'paid'
  // migrations and re-enqueues them automatically. This avoids running the
  // migration on the dev server instead of production.
  await pool.query(
    `UPDATE migrations
     SET results      = $1,
         status       = 'paid',
         error_message = NULL,
         completed_at  = NULL,
         started_at    = NULL,
         last_progress_at = NULL
     WHERE id = $2`,
    [JSON.stringify(updatedResults), MIGRATION_ID]
  );

  logger.info(
    `DB updated: idMap cleaned, status → 'paid'. ` +
    `Production server will pick this up within 5 minutes and re-run it.`
  );
  logger.info('=== Ely-StuMU remediation script complete ===');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Remediation script FAILED', { error: err.message, stack: err.stack });
    process.exit(1);
  });
