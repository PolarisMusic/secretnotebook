// 009 — Phase-1.5 R5 entitlement cache. Tracks the device's most
// recently validated IAP receipt so the publish gate can short-circuit
// without re-validating on every action. Singleton row enforced via
// `CHECK (id = 1)` + INSERT OR REPLACE in the writer; the table only
// ever has zero rows (no entitlement) or one row (current cache).
//
// Receipts ARE platform-signed blobs that we don't try to verify
// in-process — that's the ReceiptValidator's job, and in production
// validation lives on the server so a tampered local-only client
// can't forge entitlement. We keep the raw `receipt` bytes around
// for two reasons:
//   - re-validation after a long offline stretch (the cached
//     expires_at may be stale relative to the platform's current
//     view of the subscription, especially across cancellations
//     and refunds)
//   - server-side audit if a publish goes through and we need to
//     trace the entitlement that authorised it.
//
// Per-device, not per-connection. Apple/Google entitlements are tied
// to the purchasing account, so two paired devices have independent
// caches and there's no CRDT op for this — the publish gate consults
// the LOCAL cache only.
export const sql = `
CREATE TABLE IF NOT EXISTS entitlement (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  product_id   TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  validated_at INTEGER NOT NULL,
  receipt      BLOB NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android'))
);
`;
