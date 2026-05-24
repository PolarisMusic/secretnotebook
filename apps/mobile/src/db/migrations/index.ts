import { sql as initSql } from './001-init';
import { sql as coupleRatchetSql } from './002-couple-ratchet';
import { sql as dropCoupleLoopSql } from './004-drop-couple-loop';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { id: 1, name: 'init', sql: initSql },
  { id: 2, name: 'couple-ratchet', sql: coupleRatchetSql },
  { id: 4, name: 'drop-couple-loop', sql: dropCoupleLoopSql },
];
