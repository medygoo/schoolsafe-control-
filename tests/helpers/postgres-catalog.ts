import type { ClientBase, QueryResultRow } from "pg";

type CatalogClient = Pick<ClientBase, "query">;

export type NormalizedPostgresCatalog = {
  tables: string[];
  columns: Array<{
    table: string;
    column: string;
    type: string;
    nullable: boolean;
    default: string | null;
  }>;
  constraints: Array<{
    table: string;
    name: string;
    kind: "check" | "foreign_key" | "primary_key" | "unique";
    definition: string;
  }>;
  indexes: Array<{
    table: string;
    name: string;
    definition: string;
  }>;
};

function normalizeSql(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim() ?? null;
}

async function rows<T extends QueryResultRow>(client: CatalogClient, sql: string): Promise<T[]> {
  return (await client.query<T>(sql)).rows;
}

export async function readNormalizedPostgresCatalog(client: CatalogClient): Promise<NormalizedPostgresCatalog> {
  const tables = await rows<{ table_name: string }>(
    client,
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`
  );
  const columns = await rows<{
    table_name: string;
    column_name: string;
    formatted_type: string;
    is_not_null: boolean;
    column_default: string | null;
  }>(
    client,
    `SELECT c.relname AS table_name,
            a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS formatted_type,
            a.attnotnull AS is_not_null,
            pg_get_expr(d.adbin, d.adrelid) AS column_default
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attname`
  );
  const constraints = await rows<{
    table_name: string;
    constraint_name: string;
    constraint_type: "c" | "f" | "p" | "u";
    definition: string;
  }>(
    client,
    `SELECT c.relname AS table_name,
            con.conname AS constraint_name,
            con.contype AS constraint_type,
            pg_get_constraintdef(con.oid, true) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND con.contype IN ('c', 'f', 'p', 'u')
      ORDER BY c.relname, con.conname`
  );
  const indexes = await rows<{
    table_name: string;
    index_name: string;
    definition: string;
  }>(
    client,
    `SELECT table_rel.relname AS table_name,
            index_rel.relname AS index_name,
            pg_get_indexdef(index_rel.oid) AS definition
       FROM pg_index idx
       JOIN pg_class table_rel ON table_rel.oid = idx.indrelid
       JOIN pg_class index_rel ON index_rel.oid = idx.indexrelid
       JOIN pg_namespace n ON n.oid = table_rel.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY table_rel.relname, index_rel.relname`
  );
  const constraintKinds = {
    c: "check",
    f: "foreign_key",
    p: "primary_key",
    u: "unique"
  } as const;

  return {
    tables: tables.map((row) => row.table_name),
    columns: columns.map((row) => ({
      table: row.table_name,
      column: row.column_name,
      type: row.formatted_type,
      nullable: !row.is_not_null,
      default: normalizeSql(row.column_default)
    })),
    constraints: constraints.map((row) => ({
      table: row.table_name,
      name: row.constraint_name,
      kind: constraintKinds[row.constraint_type],
      definition: normalizeSql(row.definition) ?? ""
    })),
    indexes: indexes.map((row) => ({
      table: row.table_name,
      name: row.index_name,
      definition: normalizeSql(row.definition) ?? ""
    }))
  };
}
