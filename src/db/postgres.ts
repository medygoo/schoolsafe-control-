import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ControlDatabase,
  Instance,
  CardPrintRequest,
  DeviceRecord,
  DeviceStatus,
  CreateDeviceInput,
  CardPrintBatch,
  CardPrintBatchStatus,
  CreateCardPrintBatchInput,
  CreateInstanceInput,
  CreateCardPrintRequestInput,
  LicenseRecord,
  CreateLicenseInput
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
    setup_token: row.setup_token ? String(row.setup_token) : null,
    hmac_secret: String(row.hmac_secret),
    is_blocked: Boolean(row.is_blocked),
    blocked_at: row.blocked_at ? String(row.blocked_at) : null,
    trial_started_at: row.trial_started_at ? String(row.trial_started_at) : null,
    grace_ends_at: row.grace_ends_at ? String(row.grace_ends_at) : null,
    activated_at: row.activated_at ? String(row.activated_at) : null,
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

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
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
       (school_name, school_slug, domain, api_base, supabase_url, status, setup_token, hmac_secret, trial_started_at, grace_ends_at, activated_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [input.school_name, input.school_slug, input.domain, input.api_base, input.supabase_url,
       input.status, input.setup_token, input.hmac_secret,
       input.trial_started_at, input.grace_ends_at, input.activated_at,
       input.created_at, input.updated_at]
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
        status = $6, setup_token = $7, hmac_secret = $8, is_blocked = $9, blocked_at = $10, trial_started_at = $11, grace_ends_at = $12, activated_at = $13, updated_at = $14
       WHERE id = $15 RETURNING *`,
      [next.school_name, next.school_slug, next.domain, next.api_base, next.supabase_url,
       next.status, next.setup_token, next.hmac_secret,
       next.is_blocked, next.blocked_at,
       next.trial_started_at, next.grace_ends_at, next.activated_at, next.updated_at, id]
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

  // ————— Card print batches (lots ZIP de cartes) —————

  private rowToBatch(row: Record<string, unknown>): CardPrintBatch {
    return {
      id: String(row.id),
      instance_id: String(row.instance_id),
      school_id: String(row.school_id),
      batch_id: String(row.batch_id),
      version: Number(row.version),
      card_count: Number(row.card_count),
      r2_key: String(row.r2_key),
      zip_signed_url: String(row.zip_signed_url),
      signed_url_expires_at: String(row.signed_url_expires_at),
      zip_sha256: String(row.zip_sha256),
      status: (row.status as CardPrintBatchStatus) ?? "pending",
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {}),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  async getCardPrintBatches(filters?: { status?: string; instance_id?: string }): Promise<CardPrintBatch[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) { params.push(filters.status); conditions.push("status = $" + params.length); }
    if (filters?.instance_id) { params.push(filters.instance_id); conditions.push("instance_id = $" + params.length); }
    const where = conditions.length ? " where " + conditions.join(" and ") : "";
    const result = await this.pool.query("select * from card_print_batches" + where + " order by created_at desc", params);
    return result.rows.map((r: Record<string, unknown>) => this.rowToBatch(r));
  }

  async createCardPrintBatch(input: CreateCardPrintBatchInput): Promise<CardPrintBatch> {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      "insert into card_print_batches (instance_id, school_id, batch_id, version, card_count, r2_key, zip_signed_url, signed_url_expires_at, zip_sha256, status, metadata, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) returning *",
      [input.instance_id, input.school_id, input.batch_id, input.version, input.card_count, input.r2_key,
       input.zip_signed_url, input.signed_url_expires_at, input.zip_sha256, input.status ?? "pending",
       JSON.stringify(input.metadata ?? {}), now]
    );
    return this.rowToBatch(result.rows[0]);
  }

  async updateCardPrintBatch(id: string, patch: Partial<CardPrintBatch>): Promise<CardPrintBatch | undefined> {
    const result = await this.pool.query(
      "update card_print_batches set status = coalesce($1, status), updated_at = $2 where id = $3 returning *",
      [patch.status ?? null, new Date().toISOString(), id]
    );
    return result.rows[0] ? this.rowToBatch(result.rows[0]) : undefined;
  }

  // ————— Device Hub : registre maître du matériel —————

  private rowToDevice(row: Record<string, unknown>): DeviceRecord {
    return {
      id: String(row.id),
      instance_id: String(row.instance_id),
      school_id: String(row.school_id),
      device_code: String(row.device_code),
      vendor: String(row.vendor),
      model: String(row.model),
      serial_number: String(row.serial_number),
      location: row.location ? String(row.location) : null,
      status: (row.status as DeviceStatus) ?? "registered",
      last_seen_at: row.last_seen_at ? String(row.last_seen_at) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  async getDevices(filters?: { status?: string; instance_id?: string }): Promise<DeviceRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) { params.push(filters.status); conditions.push("status = $" + params.length); }
    if (filters?.instance_id) { params.push(filters.instance_id); conditions.push("instance_id = $" + params.length); }
    const where = conditions.length ? " where " + conditions.join(" and ") : "";
    const result = await this.pool.query("select * from devices" + where + " order by created_at desc", params);
    return result.rows.map((r: Record<string, unknown>) => this.rowToDevice(r));
  }

  async createDevice(input: CreateDeviceInput): Promise<DeviceRecord> {
    const result = await this.pool.query(
      "insert into devices (instance_id, school_id, device_code, vendor, model, serial_number, location) values ($1,$2,$3,$4,$5,$6,$7) returning *",
      [input.instance_id, input.school_id, input.device_code, input.vendor, input.model, input.serial_number, input.location ?? null]
    );
    return this.rowToDevice(result.rows[0]);
  }

  async updateDevice(id: string, patch: Partial<DeviceRecord>): Promise<DeviceRecord | undefined> {
    const result = await this.pool.query(
      "update devices set status = coalesce($1, status), last_seen_at = coalesce($2, last_seen_at), updated_at = $3 where id = $4 returning *",
      [patch.status ?? null, patch.last_seen_at ?? null, new Date().toISOString(), id]
    );
    return result.rows[0] ? this.rowToDevice(result.rows[0]) : undefined;
  }
  async getAuthorizedSchoolIds(instanceId: string): Promise<string[]> { const r=await this.pool.query("select school_id from instance_school_registry where instance_id=$1 and status='active' order by school_id",[instanceId]); return r.rows.map((x:any)=>String(x.school_id)); }
  async bindInstanceSchool(instanceId: string, schoolId: string): Promise<void> { await this.pool.query("insert into instance_school_registry(instance_id,school_id,status) values($1,$2,'active') on conflict(instance_id,school_id) do update set status='active',updated_at=now()",[instanceId,schoolId]); }
  async getLicense(instanceId: string, schoolId: string): Promise<LicenseRecord|undefined> { const r=await this.pool.query("select * from licenses where instance_id=$1 and school_id=$2",[instanceId,schoolId]); const x=r.rows[0]; if(!x || !x.expires_at) return undefined; return {instance_id:String(x.instance_id),school_id:String(x.school_id),license_id:String(x.license_id),status:x.status,issued_at:new Date(x.issued_at).toISOString(),expires_at:new Date(x.expires_at).toISOString(),grace_days:Number(x.grace_days),metadata:x.metadata||{}}; }
  async upsertLicense(i: CreateLicenseInput): Promise<LicenseRecord> { await this.pool.query("insert into licenses(instance_id,school_id,license_id,status,issued_at,expires_at,grace_days,metadata) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(instance_id,school_id) do update set license_id=excluded.license_id,status=excluded.status,issued_at=excluded.issued_at,expires_at=excluded.expires_at,grace_days=excluded.grace_days,metadata=excluded.metadata",[i.instance_id,i.school_id,i.license_id,i.status,i.issued_at,i.expires_at,i.grace_days,i.metadata||{}]); return (await this.getLicense(i.instance_id,i.school_id))!; }

  // ————— Trial / Grace management —————
  async startTrial(instanceId: string): Promise<Instance | undefined> {
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const graceEnds = new Date(trialEnds.getTime() + 3 * 24 * 60 * 60 * 1000);
    const result = await this.pool.query(
      "UPDATE instances SET status = 'trial', trial_started_at = $1, grace_ends_at = $2, updated_at = $3 WHERE id = $4 RETURNING *",
      [now.toISOString(), graceEnds.toISOString(), now.toISOString(), instanceId]
    );
    return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
  }

  async consumeSetupToken(token: string): Promise<Instance | undefined> {
// Atomic consumption with state validation: only trial or grace allowed, and grace must not be expired.
const result = await this.pool.query(
"UPDATE instances SET setup_token = NULL, updated_at = NOW() WHERE setup_token = $1 AND status IN ('trial', 'grace') AND (status != 'grace' OR grace_ends_at > NOW()) RETURNING *",
[token]
);
return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
}

async activateInstance(instanceId: string): Promise<Instance | undefined> {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      "UPDATE instances SET status = 'active', activated_at = $1, setup_token = NULL, updated_at = $2 WHERE id = $3 RETURNING *",
      [now, now, instanceId]
    );
    return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
  }

  async suspendInstance(instanceId: string): Promise<Instance | undefined> {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      "UPDATE instances SET status = 'suspended', updated_at = $1 WHERE id = $2 RETURNING *",
      [now, instanceId]
    );
    return result.rows[0] ? rowToInstance(result.rows[0]) : undefined;
  }

  async checkAndExpireTrials(): Promise<void> {
    const now = new Date().toISOString();
    // Expire trials that have passed their 14-day period into grace
    await this.pool.query(
      "UPDATE instances SET status = 'grace', updated_at = $1 WHERE status = 'trial' AND trial_started_at <= NOW() - INTERVAL '14 days'"
    , [now]);
    // Suspend instances in grace period that have expired
    await this.pool.query(
      "UPDATE instances SET status = 'suspended', updated_at = $1 WHERE status = 'grace' AND grace_ends_at <= NOW()"
    , [now]);
  }

}

