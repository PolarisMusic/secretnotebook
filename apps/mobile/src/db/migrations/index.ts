import { sql as initSql } from './001-init';
import { sql as coupleRatchetSql } from './002-couple-ratchet';
import { sql as roleplaySessionExtraSql } from './003-roleplay-session-extra';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { id: 1, name: 'init', sql: initSql },
  { id: 2, name: 'couple-ratchet', sql: coupleRatchetSql },
  { id: 3, name: 'roleplay-session-extra', sql: roleplaySessionExtraSql },
];
