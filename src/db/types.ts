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
}
