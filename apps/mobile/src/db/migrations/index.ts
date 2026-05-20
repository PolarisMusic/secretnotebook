import { sql as initSql } from './001-init';
import { sql as coupleRatchetSql } from './002-couple-ratchet';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { id: 1, name: 'init', sql: initSql },
  { id: 2, name: 'couple-ratchet', sql: coupleRatchetSql },
];
