/**
 * REST API-backed implementation of {@link HiveRepository}.
 *
 * Talks to the Cloudflare Worker API (Phase 3) over `fetch`. Every request is
 * authenticated through Cloudflare Access at the perimeter; the browser sends
 * the `Cf-Access-Jwt-Assertion` cookie automatically, so no token is managed
 * here.
 *
 * The backend returns a stable error envelope `{ error: { code, message } }`
 * for non-2xx responses. {@link ApiRepository} maps that envelope to a
 * descriptive `Error` (see {@link ApiError}).
 *
 * Not every `HiveRepository` method has a corresponding purpose-built endpoint
 * yet. Methods without a backend route throw a descriptive
 * {@link UnsupportedOperationError} rather than silently returning wrong data.
 */

import type {
  ActivityEvent,
  AgentAccessGrant,
  AgentLicense,
  AgentProduct,
  CommercialArrangement,
  Customer,
  FeatureEntitlement,
  LedgerTransaction,
  LedgerTransactionKind,
  PrepaidCommercialArrangement,
  Subscription,
  UsageRecord,
} from "@/domain/types";
import type {
  AgentAccessGrantInput,
  CommercialArrangementInput,
} from "@/domain/commercial-rules";
import type {
  AccountStatementRow,
  UsagePeriod,
} from "@/domain/ledger-rules";
import type {
  AgentAccessSnapshot,
  AgentCustomerAccessRow,
  AgentUsageSummaryRow,
  CommercialSnapshot,
  CustomerInput,
  HiveRepository,
  OperatorIdentity,
  PrepaidSnapshot,
  UsageSummary,
} from "@/data/local-storage-repository";

/** Backend error envelope: `{ error: { code, message } }`. */
interface ApiErrorEnvelope {
  error: { code: string; message: string };
}

/** Thrown when the backend returns a non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Thrown when a `HiveRepository` method has no backend endpoint yet. */
export class UnsupportedOperationError extends Error {
  constructor(method: string) {
    super(
      `ApiRepository does not support "${method}" yet: the Worker API has no endpoint for this operation.`
    );
    this.name = "UnsupportedOperationError";
  }
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: { message?: unknown } }).error !== null
  );
}

/**
 * Parse a non-2xx `Response` into an {@link ApiError}. Prefers the backend
 * error envelope; falls back to the HTTP status text when the body is not the
 * expected shape.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let code = "http-error";
  let message = response.statusText || `Request failed with status ${response.status}.`;
  try {
    const body: unknown = await response.json();
    if (isErrorEnvelope(body)) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // Non-JSON error body; keep the status-text fallback.
  }
  return new ApiError(response.status, code, message);
}

/** Read a JSON body, throwing an {@link ApiError} for non-2xx responses. */
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}

/**
 * REST API-backed implementation of {@link HiveRepository}.
 *
 * `baseUrl` defaults to the same origin (the Worker serves both the SPA and
 * the `/api/*` surface). Pass an absolute URL in tests.
 */
export class ApiRepository implements HiveRepository {
  private readonly baseUrl: string;

  constructor(baseUrl = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  // -- request helpers ------------------------------------------------------

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    return readJson<T>(response);
  }

  private async requestVoid(path: string, init?: RequestInit): Promise<void> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw await toApiError(response);
    }
  }

  // -- HiveRepository -------------------------------------------------------

  async hasData(): Promise<boolean> {
    const { customers } = await this.request<{ customers: Customer[] }>(
      "/api/customers"
    );
    return customers.length > 0;
  }

  async getCurrentOperator(): Promise<OperatorIdentity> {
    const { identity } = await this.request<{ identity: OperatorIdentity }>(
      "/api/me"
    );
    return identity;
  }

  async reset(): Promise<void> {
    throw new UnsupportedOperationError("reset");
  }

  // --- Customers -----------------------------------------------------------

  async listCustomers(): Promise<Customer[]> {
    const { customers } = await this.request<{ customers: Customer[] }>(
      "/api/customers"
    );
    return customers;
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    try {
      const { customer } = await this.request<{ customer: Customer }>(
        `/api/customers/${encodeURIComponent(id)}`
      );
      return customer;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async createCustomer(input: CustomerInput): Promise<Customer> {
    const { customer } = await this.request<{ customer: Customer }>(
      "/api/customers",
      { method: "POST", body: JSON.stringify(input) }
    );
    return customer;
  }

  async updateCustomer(_id: string, _input: CustomerInput): Promise<Customer> {
    // The Worker API has no PUT /api/customers/:id endpoint yet.
    throw new UnsupportedOperationError("updateCustomer");
  }

  async archiveCustomer(id: string): Promise<void> {
    await this.requestVoid(`/api/customers/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  // --- Legacy compatibility projections ------------------------------------

  async getSubscriptions(_customerId: string): Promise<Subscription[]> {
    throw new UnsupportedOperationError("getSubscriptions");
  }

  async getFeatureEntitlements(
    _customerId: string
  ): Promise<FeatureEntitlement[]> {
    throw new UnsupportedOperationError("getFeatureEntitlements");
  }

  async getAgentLicenses(_customerId: string): Promise<AgentLicense[]> {
    throw new UnsupportedOperationError("getAgentLicenses");
  }

  // --- Catalog -------------------------------------------------------------

  async listAgentProducts(): Promise<AgentProduct[]> {
    const { products } = await this.request<{ products: AgentProduct[] }>(
      "/api/agents"
    );
    return products;
  }

  async getAgentProduct(id: string): Promise<AgentProduct | undefined> {
    try {
      const { product } = await this.request<{ product: AgentProduct }>(
        `/api/agents/${encodeURIComponent(id)}`
      );
      return product;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async listCustomersWithAgentAccess(
    _agentProductId: string,
    _asOf: string | number
  ): Promise<AgentCustomerAccessRow[]> {
    throw new UnsupportedOperationError("listCustomersWithAgentAccess");
  }

  // --- Commercial arrangements --------------------------------------------

  async listCommercialArrangements(
    customerId: string
  ): Promise<CommercialArrangement[]> {
    const snapshot = await this.getCommercialSnapshot(customerId, Date.now());
    return snapshot.history;
  }

  async getCommercialSnapshot(
    customerId: string,
    _asOf: string | number
  ): Promise<CommercialSnapshot> {
    const snapshot = await this.request<CommercialSnapshot>(
      `/api/customers/${encodeURIComponent(customerId)}/commercial`
    );
    return snapshot;
  }

  async saveCommercialArrangement(
    input: CommercialArrangementInput,
    occurredAt: string
  ): Promise<CommercialArrangement> {
    const customerId = input.customerId as string;
    const { arrangement } = await this.request<{
      arrangement: CommercialArrangement;
    }>(`/api/customers/${encodeURIComponent(customerId)}/commercial`, {
      method: "POST",
      body: JSON.stringify({ ...input, occurredAt }),
    });
    return arrangement;
  }

  async terminateCommercialArrangement(
    input: { arrangementId: string; customerId: string; reason: string },
    occurredAt: string
  ): Promise<CommercialArrangement> {
    const { arrangement } = await this.request<{
      arrangement: CommercialArrangement;
    }>(
      `/api/customers/${encodeURIComponent(input.customerId)}/commercial/${encodeURIComponent(input.arrangementId)}/terminate`,
      {
        method: "POST",
        body: JSON.stringify({ reason: input.reason, occurredAt }),
      }
    );
    return arrangement;
  }

  async reconcileCommercialLifecycle(
    _customerId: string,
    _asOf: string
  ): Promise<void> {
    throw new UnsupportedOperationError("reconcileCommercialLifecycle");
  }

  // --- Agent access grants -------------------------------------------------

  async listAgentAccessGrants(customerId: string): Promise<AgentAccessGrant[]> {
    const snapshot = await this.getAgentAccessSnapshot(customerId, Date.now());
    return [...snapshot.current, ...snapshot.scheduled, ...snapshot.history];
  }

  async getAgentAccessSnapshot(
    customerId: string,
    _asOf: string | number
  ): Promise<AgentAccessSnapshot> {
    const snapshot = await this.request<AgentAccessSnapshot>(
      `/api/customers/${encodeURIComponent(customerId)}/access`
    );
    return snapshot;
  }

  async grantAgentAccess(
    input: AgentAccessGrantInput,
    occurredAt: string
  ): Promise<AgentAccessGrant> {
    const customerId = input.customerId as string;
    const { grant } = await this.request<{ grant: AgentAccessGrant }>(
      `/api/customers/${encodeURIComponent(customerId)}/access`,
      {
        method: "POST",
        body: JSON.stringify({ ...input, occurredAt }),
      }
    );
    return grant;
  }

  async revokeAgentAccess(
    input: {
      grantId: string;
      customerId: string;
      reason: string;
      effectiveAt?: string;
    },
    occurredAt: string
  ): Promise<AgentAccessGrant> {
    const { grant } = await this.request<{ grant: AgentAccessGrant }>(
      `/api/customers/${encodeURIComponent(input.customerId)}/access/${encodeURIComponent(input.grantId)}/revoke`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: input.reason,
          effectiveAt: input.effectiveAt,
          occurredAt,
        }),
      }
    );
    return grant;
  }

  // --- Activity ------------------------------------------------------------

  async listActivityEvents(_customerId: string): Promise<ActivityEvent[]> {
    // The Worker exposes audit entries (a different shape) under /audit; the
    // canonical ActivityEvent timeline is not yet served by the API.
    throw new UnsupportedOperationError("listActivityEvents");
  }

  // --- Prepaid token ledger ------------------------------------------------

  async listLedgerTransactions(
    _customerId: string
  ): Promise<LedgerTransaction[]> {
    throw new UnsupportedOperationError("listLedgerTransactions");
  }

  async getTokenBalance(_customerId: string): Promise<number> {
    throw new UnsupportedOperationError("getTokenBalance");
  }

  async getPrepaidSnapshot(
    _customerId: string,
    _asOf: string | number
  ): Promise<PrepaidSnapshot> {
    throw new UnsupportedOperationError("getPrepaidSnapshot");
  }

  async addCreditGrant(
    input: {
      customerId: string;
      amountTokens: number;
      reference: string;
      reason?: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction> {
    const { transaction } = await this.request<{
      transaction: LedgerTransaction;
    }>(`/api/customers/${encodeURIComponent(input.customerId)}/ledger/credit`, {
      method: "POST",
      body: JSON.stringify({
        amountTokens: input.amountTokens,
        reference: input.reference,
        reason: input.reason,
        occurredAt,
      }),
    });
    return transaction;
  }

  async recordUsageDebit(
    input: {
      customerId: string;
      agentProductId: string;
      tokenQuantity: number;
      sourceReference: string;
      reason?: string;
    },
    occurredAt: string
  ): Promise<{ usage: UsageRecord; transaction: LedgerTransaction }> {
    const { usage, transaction } = await this.request<{
      usage: UsageRecord;
      transaction: LedgerTransaction;
    }>(`/api/customers/${encodeURIComponent(input.customerId)}/ledger/usage`, {
      method: "POST",
      body: JSON.stringify({
        agentProductId: input.agentProductId,
        tokenQuantity: input.tokenQuantity,
        sourceReference: input.sourceReference,
        reason: input.reason,
        occurredAt,
      }),
    });
    return { usage, transaction };
  }

  async addManualAdjustment(
    input: {
      customerId: string;
      amountTokens: number;
      reference: string;
      reason: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction> {
    const { transaction } = await this.request<{
      transaction: LedgerTransaction;
    }>(
      `/api/customers/${encodeURIComponent(input.customerId)}/ledger/adjustment`,
      {
        method: "POST",
        body: JSON.stringify({
          amountTokens: input.amountTokens,
          reference: input.reference,
          reason: input.reason,
          occurredAt,
        }),
      }
    );
    return transaction;
  }

  async reverseTransaction(
    input: {
      customerId: string;
      transactionId: string;
      reference: string;
      reason: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction> {
    const { transaction } = await this.request<{
      transaction: LedgerTransaction;
    }>(
      `/api/customers/${encodeURIComponent(input.customerId)}/ledger/reversal`,
      {
        method: "POST",
        body: JSON.stringify({
          transactionId: input.transactionId,
          reference: input.reference,
          reason: input.reason,
          occurredAt,
        }),
      }
    );
    return transaction;
  }

  async updateWarningThreshold(
    customerId: string,
    thresholdTokens: number
  ): Promise<PrepaidCommercialArrangement> {
    const { arrangement } = await this.request<{
      arrangement: PrepaidCommercialArrangement;
    }>(
      `/api/customers/${encodeURIComponent(customerId)}/ledger/threshold`,
      {
        method: "PUT",
        body: JSON.stringify({ thresholdTokens }),
      }
    );
    return arrangement;
  }

  async getAccountStatement(customerId: string): Promise<AccountStatementRow[]> {
    const { rows } = await this.request<{ rows: AccountStatementRow[] }>(
      `/api/customers/${encodeURIComponent(customerId)}/ledger`
    );
    return rows;
  }

  async getUsageSummary(
    customerId: string,
    period: UsagePeriod,
    agentProductId?: string,
    type?: LedgerTransactionKind
  ): Promise<UsageSummary> {
    const params = new URLSearchParams();
    if (period.from) params.set("from", period.from);
    if (period.to) params.set("to", period.to);
    if (agentProductId) params.set("agentProductId", agentProductId);
    if (type) params.set("type", type);
    const query = params.toString();
    const summary = await this.request<UsageSummary>(
      `/api/customers/${encodeURIComponent(customerId)}/usage-summary${query ? `?${query}` : ""}`
    );
    return summary;
  }
}

/**
 * Default shared singleton. The application renders through this instance so
 * that navigating between pages does not re-fetch data unnecessarily.
 */
export const apiRepository: ApiRepository = new ApiRepository();