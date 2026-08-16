import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

export type DatabaseSchema = {
  instances: Instance[];
  cardPrintRequests: CardPrintRequest[];
};

const DEFAULT_SCHEMA: DatabaseSchema = {
  instances: [],
  cardPrintRequests: []
};

export class JsonStore {
  private data: DatabaseSchema;

  constructor(private readonly path: string) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    if (!existsSync(this.path)) return structuredClone(DEFAULT_SCHEMA);
    try {
      const raw = readFileSync(this.path, "utf-8");
      const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
      return {
        instances: parsed.instances ?? [],
        cardPrintRequests: parsed.cardPrintRequests ?? []
      };
    } catch {
      return structuredClone(DEFAULT_SCHEMA);
    }
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf-8");
  }

  getInstances(): Instance[] {
    return structuredClone(this.data.instances);
  }

  getInstanceById(id: string): Instance | undefined {
    return structuredClone(this.data.instances.find(i => i.id === id));
  }

  getInstanceBySlug(slug: string): Instance | undefined {
    return structuredClone(this.data.instances.find(i => i.school_slug === slug));
  }

  getInstanceBySetupToken(token: string): Instance | undefined {
    return structuredClone(this.data.instances.find(i => i.setup_token === token));
  }

  createInstance(instance: Instance): Instance {
    this.data.instances.push(instance);
    this.save();
    return structuredClone(instance);
  }

  updateInstance(id: string, patch: Partial<Instance>): Instance | undefined {
    const idx = this.data.instances.findIndex(i => i.id === id);
    if (idx === -1) return undefined;
    this.data.instances[idx] = { ...this.data.instances[idx], ...patch, updated_at: new Date().toISOString() };
    this.save();
    return structuredClone(this.data.instances[idx]);
  }

  getCardPrintRequests(): CardPrintRequest[] {
    return structuredClone(this.data.cardPrintRequests);
  }

  getCardPrintRequestById(id: string): CardPrintRequest | undefined {
    return structuredClone(this.data.cardPrintRequests.find(r => r.id === id));
  }

  createCardPrintRequest(request: CardPrintRequest): CardPrintRequest {
    this.data.cardPrintRequests.push(request);
    this.save();
    return structuredClone(request);
  }

  updateCardPrintRequest(id: string, patch: Partial<CardPrintRequest>): CardPrintRequest | undefined {
    const idx = this.data.cardPrintRequests.findIndex(r => r.id === id);
    if (idx === -1) return undefined;
    this.data.cardPrintRequests[idx] = { ...this.data.cardPrintRequests[idx], ...patch, updated_at: new Date().toISOString() };
    this.save();
    return structuredClone(this.data.cardPrintRequests[idx]);
  }

  reset(): void {
    this.data = structuredClone(DEFAULT_SCHEMA);
    this.save();
  }
}
