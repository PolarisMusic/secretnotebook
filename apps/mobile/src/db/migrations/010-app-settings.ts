// 010 — local app settings key/value store. Holds device-local UI
// preferences that aren't connection data and never sync (e.g. the
// one-time intro "seen" flag; later: media-hidden, points-display).
export const sql = `
CREATE TABLE IF NOT EXISTS app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
