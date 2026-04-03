import { Pool } from 'pg';

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';

export interface JobError {
  strategyName: string;
  ruleIndex?: number;
  error: string;
}

export interface JobRecord {
  jobId: string;
  triggeredAt: string;
  completedAt: string | null;
  sourceClientId: string;
  status: JobStatus;
  strategyCount: number | null;
  migratedCount: number | null;
  failedCount: number | null;
  errors: JobError[] | null;
  durationMs: number | null;
}

// ── Pool management ───────────────────────────────────────────────────────────

let _pool: Pool | null = null;

export function initPool(connectionString: string): void {
  _pool = new Pool({ connectionString });
}

function pool(): Pool {
  if (!_pool) throw new Error('DB pool not initialised — call initPool() first');
  return _pool;
}

// ── Repository functions ──────────────────────────────────────────────────────

/** Inserts the initial 'queued' record for a new job. */
export async function createJobRecord(params: {
  jobId: string;
  sourceClientId: string;
}): Promise<void> {
  await pool().query(
    `INSERT INTO rate_strategy_migrator.job_history
       (job_id, source_client_id, status, triggered_at)
     VALUES ($1, $2, 'queued', NOW())
     ON CONFLICT (job_id) DO NOTHING`,
    [params.jobId, params.sourceClientId]
  );
}

/** Applies a partial update to an existing job record. */
export async function updateJobRecord(
  jobId: string,
  updates: Partial<Omit<JobRecord, 'jobId' | 'triggeredAt' | 'sourceClientId'>>
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const add = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (updates.status !== undefined)       add('status', updates.status);
  if (updates.completedAt !== undefined)  add('completed_at', updates.completedAt);
  if (updates.strategyCount !== undefined) add('strategy_count', updates.strategyCount);
  if (updates.migratedCount !== undefined) add('migrated_count', updates.migratedCount);
  if (updates.failedCount !== undefined)  add('failed_count', updates.failedCount);
  if (updates.errors !== undefined)       add('errors', JSON.stringify(updates.errors));
  if (updates.durationMs !== undefined)   add('duration_ms', updates.durationMs);

  if (sets.length === 0) return;

  values.push(jobId);
  await pool().query(
    `UPDATE rate_strategy_migrator.job_history SET ${sets.join(', ')} WHERE job_id = $${idx}`,
    values
  );
}

/** Retrieves a single job record by jobId. Returns null if not found. */
export async function getJobRecord(jobId: string): Promise<JobRecord | null> {
  const result = await pool().query(
    `SELECT job_id, triggered_at, completed_at, source_client_id, status,
            strategy_count, migrated_count, failed_count, errors, duration_ms
     FROM rate_strategy_migrator.job_history
     WHERE job_id = $1`,
    [jobId]
  );
  if (result.rows.length === 0) return null;
  return rowToRecord(result.rows[0]);
}

/** Returns paginated job history ordered by triggered_at DESC. */
export async function listJobRecords(
  limit = 20,
  offset = 0
): Promise<JobRecord[]> {
  const result = await pool().query(
    `SELECT job_id, triggered_at, completed_at, source_client_id, status,
            strategy_count, migrated_count, failed_count, errors, duration_ms
     FROM rate_strategy_migrator.job_history
     ORDER BY triggered_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows.map(rowToRecord);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): JobRecord {
  return {
    jobId:           row.job_id as string,
    triggeredAt:     (row.triggered_at as Date).toISOString(),
    completedAt:     row.completed_at ? (row.completed_at as Date).toISOString() : null,
    sourceClientId:  row.source_client_id as string,
    status:          row.status as JobStatus,
    strategyCount:   row.strategy_count as number | null,
    migratedCount:   row.migrated_count as number | null,
    failedCount:     row.failed_count as number | null,
    errors:          row.errors as JobError[] | null,
    durationMs:      row.duration_ms as number | null,
  };
}
