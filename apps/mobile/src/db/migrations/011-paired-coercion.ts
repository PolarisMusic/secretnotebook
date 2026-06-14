// 011 — the Safe Word is no longer an onboarding gate, so the transient
// 'awaiting_safeword' status is retired. Any connection left in it by a
// pre-redesign build is simply a paired connection that never picked a
// password — promote it to 'paired' so the device boots straight into a
// working, synced connection.
export const sql = `
UPDATE connection SET status = 'paired' WHERE status = 'awaiting_safeword';
`;
