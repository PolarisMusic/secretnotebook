/**
 * Minimal SQL executor surface used by the migration runner, schema queries,
 * and CRDT helpers. Lets the same code drive op-sqlite on device and
 * better-sqlite3 in Node-side unit tests without leaking either library
 * into the rest of the codebase.
 */
export interface SqlExecutor {
  /**
   * Execute one or more statements with no parameters. Used for migrations
   * and any other DDL that legitimately needs multi-statement SQL.
   */
  executeBatch(sql: string): Promise<void>;

  /**
   * Execute a single parametrised statement (INSERT / UPDATE / DELETE / DDL).
   */
  execute(sql: string, params?: ReadonlyArray<unknown>): Promise<void>;

  /**
   * Run a single parametrised SELECT and return the rows.
   */
  query<T = Record<string, unknown>>(sql: string, params?: ReadonlyArray<unknown>): Promise<T[]>;

  /**
   * Run a unit of work inside a transaction. The runner must commit on
   * successful return and roll back on throw.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
