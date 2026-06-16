import { sql as initSql } from './001-init';
import { sql as connectionRatchetSql } from './002-connection-ratchet';
import { sql as dropCoupleLoopSql } from './004-drop-couple-loop';
import { sql as renameCoupleToConnectionSql } from './005-rename-couple-to-connection';
import { sql as notesSql } from './006-notes';
import { sql as notePublishColsSql } from './007-note-publish-cols';
import { sql as connectionRolesSql } from './008-connection-roles';
import { sql as entitlementSql } from './009-entitlement';
import { sql as appSettingsSql } from './010-app-settings';
import { sql as pairedCoercionSql } from './011-paired-coercion';
import { sql as safewordTermSql } from './012-safeword-term';
import { sql as postAudienceSql } from './013-post-audience';
import { sql as attachmentsSql } from './014-attachments';
import { sql as secretUnlockSql } from './015-secret-unlock';
import { sql as severGraceSql } from './016-sever-grace';
import { sql as hiddenPostsSql } from './017-hidden-posts';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { id: 1, name: 'init', sql: initSql },
  { id: 2, name: 'connection-ratchet', sql: connectionRatchetSql },
  // 004 keeps its historical "drop-couple-loop" name on purpose —
  // it describes the surface being dropped at the moment it ran.
  { id: 4, name: 'drop-couple-loop', sql: dropCoupleLoopSql },
  { id: 5, name: 'rename-couple-to-connection', sql: renameCoupleToConnectionSql },
  { id: 6, name: 'notes', sql: notesSql },
  { id: 7, name: 'note-publish-cols', sql: notePublishColsSql },
  { id: 8, name: 'connection-roles', sql: connectionRolesSql },
  { id: 9, name: 'entitlement', sql: entitlementSql },
  { id: 10, name: 'app-settings', sql: appSettingsSql },
  { id: 11, name: 'paired-coercion', sql: pairedCoercionSql },
  { id: 12, name: 'safeword-term', sql: safewordTermSql },
  { id: 13, name: 'post-audience', sql: postAudienceSql },
  { id: 14, name: 'attachments', sql: attachmentsSql },
  { id: 15, name: 'secret-unlock', sql: secretUnlockSql },
  { id: 16, name: 'sever-grace', sql: severGraceSql },
  { id: 17, name: 'hidden-posts', sql: hiddenPostsSql },
];
