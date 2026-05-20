import { sql as initSql } from './001-init';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ id: 1, name: 'init', sql: initSql }];
