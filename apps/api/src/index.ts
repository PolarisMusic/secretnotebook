import { loadEnv, type Env } from './config.js';
import { startGc } from './cron/gc.js';
import { createDb, type Database } from './db/client.js';
import { buildApp } from './server.js';
import { DrizzleBlobMetadataStore } from './storage/blob-metadata-drizzle.js';
import { S3ObjectStore } from './storage/blob-object-s3.js';
import { DrizzleBlobStore } from './storage/blobs-drizzle.js';
import { S3BlobStore } from './storage/blobs-s3.js';
import { DrizzleDevicesStore } from './storage/devices-drizzle.js';
import { DrizzlePairRendezvousStore } from './storage/pair-rendezvous-drizzle.js';
import { DrizzlePostsStore } from './storage/posts-drizzle.js';
import { DrizzlePromptsStore } from './storage/prompts-drizzle.js';
import { DrizzleRelayStore } from './storage/relay-drizzle.js';
import type { BlobStore } from './storage/types.js';

/**
 * Pick the blob backend from config. Postgres (inline BYTEA) by default; S3/R2
 * (bucket bytes + Postgres metadata) when BLOB_BACKEND=s3. The S3_* presence
 * is already enforced by config's superRefine — the guard here just narrows
 * the optional types.
 */
function buildBlobStore(env: Env, db: Database): BlobStore {
  if (env.BLOB_BACKEND !== 's3') return new DrizzleBlobStore(db);
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error('BLOB_BACKEND=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  }
  return new S3BlobStore(
    new S3ObjectStore({
      bucket: S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    }),
    new DrizzleBlobMetadataStore(db),
  );
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is required to start the API service');
    process.exit(1);
  }
  const { db, pool } = createDb(env.DATABASE_URL);
  const relayStore = new DrizzleRelayStore(db);
  const blobsStore = buildBlobStore(env, db);
  const pairRendezvousStore = new DrizzlePairRendezvousStore(db);
  const app = await buildApp({
    env,
    postsStore: new DrizzlePostsStore(db),
    devicesStore: new DrizzleDevicesStore(db),
    relayStore,
    blobsStore,
    promptsStore: new DrizzlePromptsStore(db),
    pairRendezvousStore,
  });

  // Sweep TTL-expired blobs, relay envelopes, and pairing rendezvous rows so
  // purged data stops costing storage. Same clock the app uses; logs through
  // the app logger.
  const gc = startGc(
    { blobs: blobsStore, relay: relayStore, pairRendezvous: pairRendezvousStore },
    { logger: app.log },
  );

  const closeOnSignal = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    gc.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void closeOnSignal('SIGINT'));
  process.once('SIGTERM', () => void closeOnSignal('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    await pool.end();
    process.exit(1);
  }
}

void main();
