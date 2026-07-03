import { loadEnv } from './config.js';
import { startGc } from './cron/gc.js';
import { createDb } from './db/client.js';
import { buildApp } from './server.js';
import { DrizzleBlobStore } from './storage/blobs-drizzle.js';
import { DrizzleDevicesStore } from './storage/devices-drizzle.js';
import { DrizzlePostsStore } from './storage/posts-drizzle.js';
import { DrizzlePromptsStore } from './storage/prompts-drizzle.js';
import { DrizzleRelayStore } from './storage/relay-drizzle.js';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is required to start the API service');
    process.exit(1);
  }
  const { db, pool } = createDb(env.DATABASE_URL);
  const relayStore = new DrizzleRelayStore(db);
  const blobsStore = new DrizzleBlobStore(db);
  const app = await buildApp({
    env,
    postsStore: new DrizzlePostsStore(db),
    devicesStore: new DrizzleDevicesStore(db),
    relayStore,
    blobsStore,
    promptsStore: new DrizzlePromptsStore(db),
  });

  // Sweep TTL-expired blobs + relay envelopes so purged data stops costing
  // storage. Reads the same clock the app uses; logs through the app logger.
  const gc = startGc({ blobs: blobsStore, relay: relayStore }, { logger: app.log });

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
