// A Cloudflare D1-shaped wrapper around node:sqlite for the portal tests.
// - prepare(sql).bind(...).first() / all() / run() with D1's result shapes ({ results }, { meta: { changes } })
// - batch([...]) runs in ONE transaction and rolls back if any statement fails (D1's documented behaviour)
// - foreign keys are ON (D1 always enforces them)
// - the real migration files in migrations/portal are applied in order, exactly as `wrangler d1 migrations apply` would
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

export const MIGRATIONS_DIR = new URL("../../../migrations/portal/", import.meta.url);
export const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

/** Migrations that are written and reviewed but NOT applied anywhere yet (migrations/portal-proposed). Tests ask for them by name so the shipped list never changes by accident. */
export const PROPOSED_DIR = new URL("../../../migrations/portal-proposed/", import.meta.url);

export function openPortalDb({ migrate = true, proposed = [] } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  if (migrate) for (const f of migrationFiles()) raw.exec(readFileSync(new URL(f, MIGRATIONS_DIR), "utf8"));
  if (migrate) for (const f of proposed) raw.exec(readFileSync(new URL(f, PROPOSED_DIR), "utf8"));

  const execute = (sql, params, mode) => {
    const stmt = raw.prepare(sql);
    const returnsRows = stmt.columns().length > 0;
    if (mode === "first") return stmt.get(...params) ?? null;
    if (mode === "all" || returnsRows) {
      const results = stmt.all(...params);
      return mode === "all" ? { results, meta: { changes: 0 } } : { results, meta: { changes: results.length } };
    }
    const r = stmt.run(...params);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };

  const db = {
    raw,
    prepare(sql) {
      let params = [];
      const stmt = {
        sql,
        get params() { return params; },
        bind(...p) {
          if (p.some((v) => v === undefined)) throw new Error("D1_TYPE_ERROR: undefined cannot be bound");
          params = p;
          return stmt;
        },
        first: async () => execute(sql, params, "first"),
        all: async () => execute(sql, params, "all"),
        run: async () => execute(sql, params, "run"),
      };
      return stmt;
    },
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const out = statements.map((s) => execute(s.sql, s.params, "batch"));
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return db;
}

/** Rows straight from the raw connection, for assertions that must not go through the repository code. */
export const rows = (db, sql, ...params) => db.raw.prepare(sql).all(...params);
export const count = (db, table, where = "1=1", ...params) => db.raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
