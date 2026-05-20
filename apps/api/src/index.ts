import { loadEnv } from './config.js';
import { createDb } from './db/client.js';
import { buildApp } from './server.js';
import { DrizzleDevicesStore } from './storage/devices-drizzle.js';
import { DrizzlePostsStore } from './storage/posts-drizzle.js';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is required to start the API service');
    process.exit(1);
  }
  const { db, pool } = createDb(env.DATABASE_URL);
  const app = await buildApp({
    env,
    postsStore: new DrizzlePostsStore(db),
    devicesStore: new DrizzleDevicesStore(db),
  });

  const closeOnSignal = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
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
