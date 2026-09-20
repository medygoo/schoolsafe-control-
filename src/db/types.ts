export type InstanceStatus = "active" | "blocked";

export type Instance = {
  id: string;
  school_name: string;
  school_slug: string;
  domain: string;
  api_base: string;
  supabase_url: string;
  status: InstanceStatus;
  setup_token: string;
  hmac_secret: string;
  created_at: string;
  updated_at: string;
};

export type CardPrintRequestStatus = "pending" | "printed" | "failed";

export type CardPrintRequest = {
  id: string;
  instance_id: string;
  school_id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  academic_year: string;
  front_key: string;
  back_key: string;
  front_signed_url: string;
  back_signed_url: string;
  signed_url_expires_at: string;
  format: "badge" | "carte";
  status: CardPrintRequestStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  printed_at: string | null;
};

export type CreateInstanceInput = Omit<Instance, "id">;
export type CreateCardPrintRequestInput = Omit<CardPrintRequest, "id" | "printed_at">;

export interface ControlDatabase {
  init(): Promise<void>;
  close(): Promise<void>;
  reset?(): Promise<void>;

  getInstances(): Promise<Instance[]>;
  getInstanceById(id: string): Promise<Instance | undefined>;
  getInstanceBySlug(slug: string): Promise<Instance | undefined>;
  getInstanceBySetupToken(token: string): Promise<Instance | undefined>;
  createInstance(instance: CreateInstanceInput): Promise<Instance>;
  updateInstance(id: string, patch: Partial<Instance>): Promise<Instance | undefined>;

  getCardPrintRequests(filters?: { status?: string; instance_id?: string }): Promise<CardPrintRequest[]>;
  getCardPrintRequestById(id: string): Promise<CardPrintRequest | undefined>;
  createCardPrintRequest(request: CreateCardPrintRequestInput): Promise<CardPrintRequest>;
  updateCardPrintRequest(id: string, patch: Partial<CardPrintRequest>): Promise<CardPrintRequest | undefined>;

  getCardPrintBatches(filters?: { status?: string; instance_id?: string }): Promise<CardPrintBatch[]>;
  createCardPrintBatch(batch: CreateCardPrintBatchInput): Promise<CardPrintBatch>;
  updateCardPrintBatch(id: string, patch: Partial<CardPrintBatch>): Promise<CardPrintBatch | undefined>;


  getDevices(filters?: { status?: string; instance_id?: string }): Promise<DeviceRecord[]>;
  createDevice(device: CreateDeviceInput): Promise<DeviceRecord>;
  updateDevice(id: string, patch: Partial<DeviceRecord>): Promise<DeviceRecord | undefined>;
  getAuthorizedSchoolIds(instanceId: string): Promise<string[]>;
  bindInstanceSchool(instanceId: string, schoolId: string): Promise<void>;
  getLicense(instanceId: string, schoolId: string): Promise<LicenseRecord | undefined>;
  upsertLicense(input: CreateLicenseInput): Promise<LicenseRecord>;
}

export type CardPrintBatchStatus = "pending" | "downloaded" | "printed" | "failed";

export type CardPrintBatch = {
  id: string;
  instance_id: string;
  school_id: string;
  batch_id: string;
  version: number;
  card_count: number;
  r2_key: string;
  zip_signed_url: string;
  signed_url_expires_at: string;
  zip_sha256: string;
  status: CardPrintBatchStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreateCardPrintBatchInput = Omit<CardPrintBatch, "id" | "status" | "created_at" | "updated_at"> & { status?: CardPrintBatchStatus };

export type DeviceStatus = "registered" | "testing" | "online" | "offline" | "disabled" | "revoked";

export type DeviceRecord = {
  id: string;
  instance_id: string;
  school_id: string;
  device_code: string;
  vendor: string;
  model: string;
  serial_number: string;
  location: string | null;
  status: DeviceStatus;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateDeviceInput = Omit<DeviceRecord, "id" | "status" | "last_seen_at" | "created_at" | "updated_at">;

export type LicenseRecord = { instance_id:string; school_id:string; license_id:string; status:"active"|"suspended"|"revoked"; issued_at:string; expires_at:string; grace_days:number; metadata:Record<string,unknown>; };
export type CreateLicenseInput = LicenseRecord;
