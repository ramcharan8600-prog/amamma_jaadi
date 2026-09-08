import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';

/** Real SQLite transactions behind the small D1 surface used by service tests. */
export function createTestD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const faults: { failOnSql: RegExp | null; failuresRemaining: number } = {
    failOnSql: null,
    failuresRemaining: 0,
  };

  class Statement {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}

    bind(...values: SQLInputValue[]) {
      return new Statement(this.sql, values);
    }

    execute() {
      if (faults.failuresRemaining > 0 && faults.failOnSql?.test(this.sql)) {
        faults.failuresRemaining -= 1;
        throw new Error('Injected transient D1 statement failure');
      }
      const statement = sqlite.prepare(this.sql);
      const results = statement.all(...this.values);
      const changes = Number(sqlite.prepare('SELECT changes() AS changes').get()?.changes ?? 0);
      return { success: true, results, meta: { changes } };
    }

    async first(column?: string) {
      const row = this.execute().results[0] ?? null;
      return column && row ? row[column] : row;
    }

    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async raw() { return this.execute().results.map((row) => Object.values(row)); }
  }

  const adapter = {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql: string) { sqlite.exec(sql); return { count: 0, duration: 0 }; },
  };

  // This test adapter intentionally excludes D1-only replication/export APIs.
  // Statements, bound values, constraints and transaction rollback are real SQL.
  return { db: adapter as unknown as D1Database, sqlite, faults };
}
