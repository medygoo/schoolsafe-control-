import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
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
    metadata: JSON.parse(String(row.metadata || "{}")),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    printed_at: row.printed_at ? String(row.printed_at) : null
  };
}

export class SqliteDatabase implements ControlDatabase {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
  }

  async init(): Promise<void> {
    const schema = readFileSync(join(__dirname, "schema.sqlite.sql"), "utf-8");
    this.db.exec(schema);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async reset(): Promise<void> {
    this.db.exec("DELETE FROM card_print_requests; DELETE FROM instances; DELETE FROM admin_sessions;");
  }

  async getInstances(): Promise<Instance[]> {
    const stmt = this.db.prepare("SELECT * FROM instances ORDER BY created_at DESC");
    return (stmt.all() as Record<string, unknown>[]).map(rowToInstance);
  }

  async getInstanceById(id: string): Promise<Instance | undefined> {
    const row = this.db.prepare("SELECT * FROM instances WHERE id = ?").get(id);
    return row ? rowToInstance(row as Record<string, unknown>) : undefined;
  }

  async getInstanceBySlug(slug: string): Promise<Instance | undefined> {
    const row = this.db.prepare("SELECT * FROM instances WHERE school_slug = ?").get(slug);
    return row ? rowToInstance(row as Record<string, unknown>) : undefined;
  }

  async getInstanceBySetupToken(token: string): Promise<Instance | undefined> {
    const row = this.db.prepare("SELECT * FROM instances WHERE setup_token = ?").get(token);
    return row ? rowToInstance(row as Record<string, unknown>) : undefined;
  }

  async createInstance(input: CreateInstanceInput): Promise<Instance> {
    const id = crypto.randomUUID();
    const sql = `INSERT INTO instances
      (id, school_name, school_slug, domain, api_base, supabase_url, status, setup_token, hmac_secret, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
    this.db.prepare(sql).run(
      id, input.school_name, input.school_slug, input.domain, input.api_base, input.supabase_url,
      input.status, input.setup_token, input.hmac_secret, input.created_at, input.updated_at
    );
    return (await this.getInstanceById(id))!;
  }

  async updateInstance(id: string, patch: Partial<Instance>): Promise<Instance | undefined> {
    const existing = await this.getInstanceById(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
    this.db.prepare(
      `UPDATE instances SET
        school_name = ?, school_slug = ?, domain = ?, api_base = ?, supabase_url = ?,
        status = ?, setup_token = ?, hmac_secret = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      next.school_name, next.school_slug, next.domain, next.api_base, next.supabase_url,
      next.status, next.setup_token, next.hmac_secret, next.updated_at, id
    );
    return this.getInstanceById(id);
  }

  async getCardPrintRequests(filters?: { status?: string; instance_id?: string }): Promise<CardPrintRequest[]> {
    let sql = "SELECT * FROM card_print_requests";
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) {
      where.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.instance_id) {
      where.push("instance_id = ?");
      params.push(filters.instance_id);
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const stmt = this.db.prepare(sql);
    return (stmt.all(...params) as Record<string, unknown>[]).map(rowToRequest);
  }

  async getCardPrintRequestById(id: string): Promise<CardPrintRequest | undefined> {
    const row = this.db.prepare("SELECT * FROM card_print_requests WHERE id = ?").get(id);
    return row ? rowToRequest(row as Record<string, unknown>) : undefined;
  }

  async createCardPrintRequest(input: CreateCardPrintRequestInput): Promise<CardPrintRequest> {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO card_print_requests
       (id, instance_id, school_id, student_id, student_name, class_name, academic_year,
        front_key, back_key, front_signed_url, back_signed_url, signed_url_expires_at,
        format, status, metadata, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, input.instance_id, input.school_id, input.student_id, input.student_name, input.class_name,
      input.academic_year, input.front_key, input.back_key, input.front_signed_url, input.back_signed_url,
      input.signed_url_expires_at, input.format, input.status, JSON.stringify(input.metadata),
      input.created_at, input.updated_at
    );
    return (await this.getCardPrintRequestById(id))!;
  }

  async updateCardPrintRequest(id: string, patch: Partial<CardPrintRequest>): Promise<CardPrintRequest | undefined> {
    const existing = await this.getCardPrintRequestById(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
    this.db.prepare(
      `UPDATE card_print_requests SET
        instance_id = ?, school_id = ?, student_id = ?, student_name = ?, class_name = ?,
        academic_year = ?, front_key = ?, back_key = ?, front_signed_url = ?, back_signed_url = ?,
        signed_url_expires_at = ?, format = ?, status = ?, metadata = ?, updated_at = ?, printed_at = ?
       WHERE id = ?`
    ).run(
      next.instance_id, next.school_id, next.student_id, next.student_name, next.class_name,
      next.academic_year, next.front_key, next.back_key, next.front_signed_url, next.back_signed_url,
      next.signed_url_expires_at, next.format, next.status, JSON.stringify(next.metadata),
      next.updated_at, next.printed_at, id
    );
    return this.getCardPrintRequestById(id);
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
      metadata: JSON.parse(String(row.metadata ?? "{}")),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  async getCardPrintBatches(filters?: { status?: string; instance_id?: string }): Promise<CardPrintBatch[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) { params.push(filters.status); conditions.push("status = ?"); }
    if (filters?.instance_id) { params.push(filters.instance_id); conditions.push("instance_id = ?"); }
    const where = conditions.length ? " where " + conditions.join(" and ") : "";
    const rows = this.db.prepare("select * from card_print_batches" + where + " order by created_at desc").all(...params);
    return (rows as Record<string, unknown>[]).map((r) => this.rowToBatch(r));
  }

  async createCardPrintBatch(input: CreateCardPrintBatchInput): Promise<CardPrintBatch> {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare("insert into card_print_batches (id, instance_id, school_id, batch_id, version, card_count, r2_key, zip_signed_url, signed_url_expires_at, zip_sha256, status, metadata, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id, input.instance_id, input.school_id, input.batch_id, input.version, input.card_count, input.r2_key,
      input.zip_signed_url, input.signed_url_expires_at, input.zip_sha256, input.status ?? "pending",
      JSON.stringify(input.metadata ?? {}), now, now
    );
    const row = this.db.prepare("select * from card_print_batches where id = ?").get(id) as Record<string, unknown>;
    return this.rowToBatch(row);
  }

  async updateCardPrintBatch(id: string, patch: Partial<CardPrintBatch>): Promise<CardPrintBatch | undefined> {
    this.db.prepare("update card_print_batches set status = coalesce(?, status), updated_at = ? where id = ?").run(
      patch.status ?? null, new Date().toISOString(), id
    );
    const row = this.db.prepare("select * from card_print_batches where id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToBatch(row) : undefined;
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
    if (filters?.status) { params.push(filters.status); conditions.push("status = ?"); }
    if (filters?.instance_id) { params.push(filters.instance_id); conditions.push("instance_id = ?"); }
    const where = conditions.length ? " where " + conditions.join(" and ") : "";
    const rows = this.db.prepare("select * from devices" + where + " order by created_at desc").all(...params);
    return (rows as Record<string, unknown>[]).map((r) => this.rowToDevice(r));
  }

  async createDevice(input: CreateDeviceInput): Promise<DeviceRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("insert into devices (id, instance_id, school_id, device_code, vendor, model, serial_number, location, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)").run(
      id, input.instance_id, input.school_id, input.device_code, input.vendor, input.model, input.serial_number, input.location ?? null, now, now
    );
    const row = this.db.prepare("select * from devices where id = ?").get(id) as Record<string, unknown>;
    return this.rowToDevice(row);
  }

  async updateDevice(id: string, patch: Partial<DeviceRecord>): Promise<DeviceRecord | undefined> {
    this.db.prepare("update devices set status = coalesce(?, status), last_seen_at = coalesce(?, last_seen_at), updated_at = ? where id = ?").run(
      patch.status ?? null, patch.last_seen_at ?? null, new Date().toISOString(), id
    );
    const row = this.db.prepare("select * from devices where id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToDevice(row) : undefined;
  }
  async getAuthorizedSchoolIds(instanceId: string): Promise<string[]> { const rows=this.db.prepare("select school_id from instance_school_registry where instance_id=? and status='active' order by school_id").all(instanceId); return rows.map((r:any)=>String(r.school_id)); }
  async bindInstanceSchool(instanceId: string, schoolId: string): Promise<void> { this.db.prepare("insert into instance_school_registry(instance_id,school_id,status) values(?,?,?) on conflict(instance_id,school_id) do update set status='active',updated_at=current_timestamp").run(instanceId,schoolId,'active'); }
  async getLicense(instanceId: string, schoolId: string): Promise<LicenseRecord|undefined> { const r=this.db.prepare("select * from licenses where instance_id=? and school_id=?").get(instanceId,schoolId) as any; return r?{instance_id:String(r.instance_id),school_id:String(r.school_id),license_id:String(r.license_id),status:r.status,issued_at:String(r.issued_at),expires_at:r.expires_at?String(r.expires_at):null,grace_days:Number(r.grace_days),metadata:JSON.parse(String(r.metadata||'{}'))}:undefined; }
  async upsertLicense(i: CreateLicenseInput): Promise<LicenseRecord> { this.db.prepare("insert into licenses(instance_id,school_id,license_id,status,issued_at,expires_at,grace_days,metadata) values(?,?,?,?,?,?,?,?) on conflict(instance_id,school_id) do update set license_id=excluded.license_id,status=excluded.status,issued_at=excluded.issued_at,expires_at=excluded.expires_at,grace_days=excluded.grace_days,metadata=excluded.metadata").run(i.instance_id,i.school_id,i.license_id,i.status,i.issued_at,i.expires_at,i.grace_days,JSON.stringify(i.metadata||{})); return (await this.getLicense(i.instance_id,i.school_id))!; }

}
