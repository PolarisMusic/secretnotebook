import type { FastifyBaseLogger } from 'fastify';
import type { BlobStore, PairRendezvousStore, RelayStore } from '../storage/types.js';

/** Default sweep cadence: every 6 hours. */
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface GcStores {
  readonly blobs: BlobStore;
  readonly relay: RelayStore;
  readonly pairRendezvous: PairRendezvousStore;
}

export interface GcOptions {
  /** Sweep cadence in ms. Defaults to 6 hours. */
  readonly intervalMs?: number;
  /** Override the clock (tests). */
  readonly now?: () => Date;
  /** Where to log sweep results. */
  readonly logger?: Pick<FastifyBaseLogger, 'info' | 'error'>;
}

export interface GcHandle {
  /** Run one sweep immediately (also used by the interval). */
  readonly runOnce: () => Promise<void>;
  /** Stop the recurring sweep. */
  readonly stop: () => void;
}

/**
 * Background garbage collector for TTL-expired data. Both the blob and
 * relay stores enforce their TTL at read time already (expired rows are
 * filtered out), but nothing deletes them — so without this sweep expired
 * ciphertext accumulates forever and keeps costing storage. This runs one
 * pass on startup and then every `intervalMs`, calling each store's
 * `purgeExpired`. A failing sweep is logged and swallowed so a transient DB
 * blip never crashes the API; the next tick retries.
 */
export function startGc(stores: GcStores, opts: GcOptions = {}): GcHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = opts.now ?? (() => new Date());
  const logger = opts.logger;

  const runOnce = async (): Promise<void> => {
    const at = now();
    try {
      const [blobs, relay, pairRendezvous] = await Promise.all([
        stores.blobs.purgeExpired(at),
        stores.relay.purgeExpired(at),
        stores.pairRendezvous.purgeExpired(at),
      ]);
      if (blobs > 0 || relay > 0 || pairRendezvous > 0) {
        logger?.info({ blobs, relay, pairRendezvous }, 'gc: purged expired rows');
      }
    } catch (err) {
      logger?.error({ err }, 'gc: sweep failed (will retry next tick)');
    }
  };

  // Immediate pass on boot so a long-idle deploy cleans up right away.
  void runOnce();
  const timer = setInterval(() => void runOnce(), intervalMs);
  // Don't keep the event loop alive just for the GC timer.
  timer.unref?.();

  return {
    runOnce,
    stop: () => clearInterval(timer),
  };
}
