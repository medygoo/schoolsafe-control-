import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ControlDatabase,
  Instance,
  CardPrintRequest,
  CreateInstanceInput,
  CreateCardPrintRequestInput
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

function rowToInstance(row: Record<string, unknown>): Instance {
  return {
    id: String(row.id),
    school_name: String(row.school_name),
    school_slug: String(row.school_slug),
    domain: String(row.domain),
    api_base: String(row.api_base),
    supabase_url: String(row.supabase_url),
    status: String(row.status) as Instance["status"],
    setup_token: String(row.setup_token),
    hmac_secret: String(row.hmac_secret),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function rowToRequest(row: Record<string, unknown>): CardPrintRequest {
  return {
    id: String(row.id),
    instance_id: String(row.instance_id),
    school_id: String(row.school_id),
    student_id: String(row.student_id),
    student_name: String(row.student_name),
    class_name: String(row.class_name),
    academic_year: String(row.academic_year),
    front_key: String(row.front_key),
    back_key: String(row.back_key),
    front_signed_url: String(row.front_signed_url),
    back_signed_url: String(row.back_signed_url),
    signed_url_expires_at: String(row.signed_url_expires_at),
    format: String(row.format) as CardPrintRequest["format"],
    status: String(row.status) as CardPrintRequest["status"],
    metadata: (row.metadata as Record<string, unknown>) || {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    printed_at: row.printed_at ? String(row.printed_at) : null
  };
}

export class PostgresDatabase implements ControlDatabase {
  private pool: InstanceType<typeof Pool>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
    await this.pool.query(schema);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getInstances(): Promise<Instance[]> {
    const result = await this.pool.query(
      "SELECT * FROM instances ORDER BY created_at DESC"
    );
    return result.rows.map(rowToInstance);
  }

  async getInstanceById(id: string): Promise<Instance | undefined> {
    const result = await this.pool.query("SELECT * FROM instances WHERE id = $1", [id]);
    return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
  }

  async getInstanceBySlug(slug: string): Promise<Instance | undefined> {
    const result = await this.pool.query("SELECT * FROM instances WHERE school_slug = $1", [slug]);
    return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
  }

  async getInstanceBySetupToken(token: string): Promise<Instance | undefined> {
    const result = await this.pool.query("SELECT * FROM instances WHERE setup_token = $1", [token]);
    return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
  }

  async createInstance(input: CreateInstanceInput): Promise<Instance> {
    const result = await this.pool.query(
      `INSERT INTO instances
       (school_name, school_slug, domain, api_base, supabase_url, status, setup_token, hmac_secret, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [input.school_name, input.school_slug, input.domain, input.api_base, input.supabase_url,
       input.status, input.setup_token, input.hmac_secret, input.created_at, input.updated_at]
    );
    return rowToInstance(result.rows[0]);
  }

  async updateInstance(id: string, patch: Partial<Instance>): Promise<Instance | undefined> {
    const existing = await this.getInstanceById(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
    const result = await this.pool.query(
      `UPDATE instances SET
        school_name = $1, school_slug = $2, domain = $3, api_base = $4, supabase_url = $5,
        status = $6, setup_token = $7, hmac_secret = $8, updated_at = $9
       WHERE id = $10 RETURNING *`,
      [next.school_name, next.school_slug, next.domain, next.api_base, next.supabase_url,
       next.status, next.setup_token, next.hmac_secret, next.updated_at, id]
    );
    return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
  }

  async getCardPrintRequests(filters?: { status?: string; instance_id?: string }): Promise<CardPrintRequest[]> {
    let sql = "SELECT * FROM card_print_requests";
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    if (filters?.instance_id) {
      params.push(filters.instance_id);
      where.push(`instance_id = $${params.length}`);
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const result = await this.pool.query(sql, params);
    return result.rows.map(rowToRequest);
  }

  async getCardPrintRequestById(id: string): Promise<CardPrintRequest | undefined> {
    const result = await this.pool.query("SELECT * FROM card_print_requests WHERE id = $1", [id]);
    return result.rows[0] ? rowToRequest(result.rows[0]) : undefined;
  }

  async createCardPrintRequest(input: CreateCardPrintRequestInput): Promise<CardPrintRequest> {
    const result = await this.pool.query(
      `INSERT INTO card_print_requests
       (instance_id, school_id, student_id, student_name, class_name, academic_year,
        front_key, back_key, front_signed_url, back_signed_url, signed_url_expires_at,
        format, status, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [input.instance_id, input.school_id, input.student_id, input.student_name, input.class_name,
       input.academic_year, input.front_key, input.back_key, input.front_signed_url, input.back_signed_url,
       input.signed_url_expires_at, input.format, input.status, JSON.stringify(input.metadata),
       input.created_at, input.updated_at]
    );
    return rowToRequest(result.rows[0]);
  }

  async updateCardPrintRequest(id: string, patch: Partial<CardPrintRequest>): Promise<CardPrintRequest | undefined> {
    const existing = await this.getCardPrintRequestById(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
    const result = await this.pool.query(
      `UPDATE card_print_requests SET
        instance_id = $1, school_id = $2, student_id = $3, student_name = $4, class_name = $5,
        academic_year = $6, front_key = $7, back_key = $8, front_signed_url = $9, back_signed_url = $10,
        signed_url_expires_at = $11, format = $12, status = $13, metadata = $14, updated_at = $15, printed_at = $16
       WHERE id = $17 RETURNING *`,
      [next.instance_id, next.school_id, next.student_id, next.student_name, next.class_name,
       next.academic_year, next.front_key, next.back_key, next.front_signed_url, next.back_signed_url,
       next.signed_url_expires_at, next.format, next.status, JSON.stringify(next.metadata),
       next.updated_at, next.printed_at, id]
    );
    return result.rows[0] ? rowToRequest(result.rows[0]) : undefined;
  }
}
