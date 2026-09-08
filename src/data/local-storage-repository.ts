import type {
  AgentLicense,
  AgentProduct,
  DataStore,
  Customer,
  CustomerStatus,
  FeatureEntitlement,
  Subscription,
} from "@/domain/types";
import { buildSeedStore } from "@/data/seed-data";

/** In-memory + optional localStorage persistence for the demo data store. */

export interface CustomerInput {
  id: string;
  name: string;
  domain: string;
  contact: string;
  email: string;
  status: CustomerStatus;
  notes: string;
}

/**
 * Repository contract.
 *
 * All methods are synchronous so that the UI can render without async
 * coordination. Mutations are persisted to localStorage when available.
 */
export interface HiveRepository {
  /** Whether the repository has any customers to display. */
  hasData(): boolean;

  /** Seed the store with the canonical six customers (replaces current). */
  reset(): void;

  // --- Customers -----------------------------------------------------------
  listCustomers(): Customer[];
  getCustomer(id: string): Customer | undefined;
  createCustomer(input: CustomerInput): Customer;
  updateCustomer(id: string, input: CustomerInput): Customer;

  // --- Relationships for a customer ---------------------------------------
  getSubscriptions(customerId: string): Subscription[];
  getFeatureEntitlements(customerId: string): FeatureEntitlement[];
  getAgentLicenses(customerId: string): AgentLicense[];

  // --- Catalog -------------------------------------------------------------
  listAgentProducts(): AgentProduct[];
  getAgentProduct(id: string): AgentProduct | undefined;
}

export type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

const STORAGE_KEY = "hivarium.operator-console.store.v1";

/**
 * localStorage-based implementation of {@link HiveRepository}.
 *
 * The store is lazily seeded from {@link buildSeedStore} the first time it is
 * read. Subsequent reads are returned straight from localStorage so that a
 * refresh of the browser preserves the operator's changes.
 *
 * `createCustomer` writes only the new customer record to `customers`.
 * Subscriptions, feature entitlements and agent licenses are intentionally
 * not fabricated here — the operator workflow in Phase 1 intentionally
 * separates those concerns.
 */
export class LocalStorageRepository implements HiveRepository {
  private readonly key: string;
  private readonly storage: StorageLike | null;

  constructor(storage?: StorageLike, key: string = STORAGE_KEY) {
    this.storage =
      storage ??
      (typeof localStorage !== "undefined" ? localStorage : null);
    this.key = key;
  }

  // -- helpers --------------------------------------------------------------
  private read(): DataStore {
    if (!this.storage) return buildSeedStore();

    const raw = this.storage.getItem(this.key);
    if (!raw) {
      const seeded = buildSeedStore();
      this.storage.setItem(this.key, JSON.stringify(seeded));
      return seeded;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<DataStore>;
      return {
        customers: parsed.customers ?? [],
        subscriptions: parsed.subscriptions ?? [],
        featureEntitlements: parsed.featureEntitlements ?? [],
        agentProducts:
          parsed.agentProducts && parsed.agentProducts.length > 0
            ? parsed.agentProducts
            : buildSeedStore().agentProducts,
        agentLicenses: parsed.agentLicenses ?? [],
      };
    } catch {
      const seeded = buildSeedStore();
      this.storage.setItem(this.key, JSON.stringify(seeded));
      return seeded;
    }
  }

  private write(store: DataStore): void {
    if (this.storage) {
      this.storage.setItem(this.key, JSON.stringify(store));
    }
  }

  // -- HiveRepository -------------------------------------------------------
  hasData(): boolean {
    return this.listCustomers().length > 0;
  }

  reset(): void {
    const seeded = buildSeedStore();
    if (this.storage) {
      this.storage.removeItem(this.key);
    }
    this.write(seeded);
  }

  listCustomers(): Customer[] {
    return this.read().customers;
  }

  getCustomer(id: string): Customer | undefined {
    return this.read().customers.find((c) => c.id === id);
  }

  createCustomer(input: CustomerInput): Customer {
    const now = new Date(2026, 0, 1).toISOString(); // deterministic
    const store = this.read();
    if (store.customers.some((c) => c.id === input.id)) {
      throw new Error(`Customer with id "${input.id}" already exists`);
    }
    const created: Customer = { ...input, createdAt: now };
    this.write({ ...store, customers: [...store.customers, created] });
    return created;
  }

  updateCustomer(id: string, input: CustomerInput): Customer {
    const store = this.read();
    const existing = store.customers.find((c) => c.id === id);
    if (!existing) {
      throw new Error(`Customer with id "${id}" does not exist`);
    }
    const updated: Customer = { ...existing, ...input, id };
    this.write({
      ...store,
      customers: store.customers.map((c) => (c.id === id ? updated : c)),
    });
    return updated;
  }

  getSubscriptions(customerId: string): Subscription[] {
    return this.read().subscriptions.filter((s) => s.customerId === customerId);
  }

  getFeatureEntitlements(customerId: string): FeatureEntitlement[] {
    return this.read().featureEntitlements.filter(
      (fe) => fe.customerId === customerId
    );
  }

  getAgentLicenses(customerId: string): AgentLicense[] {
    return this.read().agentLicenses.filter(
      (lic) => lic.customerId === customerId
    );
  }

  listAgentProducts(): AgentProduct[] {
    return this.read().agentProducts;
  }

  getAgentProduct(id: string): AgentProduct | undefined {
    return this.read().agentProducts.find((p) => p.id === id);
  }
}

/**
 * Build a throw-away in-memory repository for tests.
 * Passes a Map-backed StorageLike so no real browser storage is used.
 */
export function createInMemoryRepository(seedWith = true): {
  repository: LocalStorageRepository;
  storage: StorageLike;
} {
  const map = new Map<string, string>();
  if (seedWith) {
    map.set(STORAGE_KEY, JSON.stringify(buildSeedStore()));
  }
  const storage: StorageLike = {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  return { repository: new LocalStorageRepository(storage), storage };
}

/**
 * Default shared singleton. The application renders through this instance so
 * that navigating between pages does not re-seed data.
 */
export const repository: LocalStorageRepository = new LocalStorageRepository();
