/**
 * D1-backed integration tests for the Worker data layer (D-01, D-06, D-12).
 *
 * Applies `worker/schema.sql` to the emulated D1 database exposed through the
 * `env.DB` binding (vitest-pool-workers), then exercises `worker/src/db.ts`
 * methods and the schema's own constraints:
 *
 *   * schema setup (tables, triggers, idempotent catalog seeding)
 *   * financial batch rollback (one bad statement aborts the whole batch)
 *   * negative-balance rejection (derived balances, never stored)
 *   * idempotency (exact replay, conflicting source reference, UNIQUE)
 *   * append-only protection (UPDATE/DELETE triggers on immutable tables)
 *   * stale revision conflicts (stale snapshots cannot mutate immutable rows)
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schemaSql from "../migrations/0001_initial.sql?raw";
import {
  buildAuditEntry,
  commitStoreDiff,
  diffStores,
  getCustomer,
  listLedgerTransactions,
  listUsageRecords,
  loadCustomerStore,
  seedCatalog,
  type AuditEntry,
} from "../src/db";
import type { JsonWebKeySet } from "../src/auth";
import type {
  ActivityEvent,
  AgentAccessGrant,
  Customer,
  DataStore,
  LedgerTransaction,
  PrepaidCommercialArrangement,
} from "../../src/domain/types";
import {
  applyManualAdjustment,
  assertNoNegativeBalance,
  normalizeUsageFingerprint,
  recordUsage,
  validateUsageIdempotency,
} from "../../src/domain/ledger-rules";

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

const OPERATOR = {
  email: "operator@hivarium.test",
  sub: "user_123",
  name: "Test Operator",
};

const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-02T00:00:00.000Z";
const AGENT_PRODUCT_ID = "agent_sentinel";

function db(): D1Database {
  return env.DB;
}

function makeCustomer(id: string): Customer {
  return {
    id,
    name: `Customer ${id}`,
    domain: `${id}.example`,
    contact: "Ada Lovelace",
    email: `ada@${id}.example`,
    status: "active",
    notes: "",
    createdAt: T0,
  };
}

function makePrepaid(customerId: string): PrepaidCommercialArrangement {
  return {
    id: `arr_${customerId}_prepaid`,
    customerId,
    status: "active",
    effectiveFrom: T0,
    effectiveTo: null,
    createdAt: T0,
    reason: "Initial prepaid arrangement.",
    replacedByArrangementId: null,
    model: "prepaid",
    warningThresholdTokens: 100,
    expiresAt: null,
  };
}

function makeCredit(
  customerId: string,
  amountTokens: number,
  occurredAt = T0
): LedgerTransaction {
  return {
    id: `txn_${customerId}_credit_${occurredAt}`,
    customerId,
    occurredAt,
    kind: "credit_grant",
    amountTokens,
    reason: "Operator-confirmed token credit",
    reference: `credit_${customerId}_${occurredAt}`,
  };
}

function auditFor(
  action: string,
  customerId: string,
  subjectType: string,
  subjectId: string,
  summary: string,
  occurredAt: string,
  after?: unknown
): AuditEntry {
  return buildAuditEntry({
    identity: OPERATOR,
    action,
    customerId,
    subjectType,
    subjectId,
    summary,
    after,
    occurredAt,
  });
}

/** Load the current store, apply `mutate`, and commit the diff plus audit. */
async function commit(
  customerId: string,
  mutate: (store: DataStore) => DataStore,
  audit: AuditEntry
): Promise<void> {
  const before = await loadCustomerStore(db(), customerId);
  const after = mutate(before);
  const diff = diffStores(before, after);
  await commitStoreDiff(db(), diff, audit);
}

// ---------------------------------------------------------------------------
// Authenticated API helpers (D-03): mint a real RS256 Access JWT and drive
// the Worker through SELF.fetch so route-level guards (e.g. the archived
// customer rejection) are exercised end to end.
// ---------------------------------------------------------------------------

const TEAM_DOMAIN = "example.cloudflareaccess.com";
const AUDIENCE = "replace-with-access-application-aud";

function base64UrlEncode(input: string | Uint8Array | ArrayBuffer): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface TestSigner {
  jwks: JsonWebKeySet;
  sign: (claims: Record<string, unknown>) => Promise<string>;
}

/** Generate an RSA key pair and a signer that mints RS256 JWTs for it. */
async function createTestSigner(kid = "test-key-1"): Promise<TestSigner> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jwks: JsonWebKeySet = {
    keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }],
  };
  const sign = async (claims: Record<string, unknown>): Promise<string> => {
    const header = { alg: "RS256", kid, typ: "JWT" };
    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(claims));
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      data
    );
    return `${headerB64}.${payloadB64}.${base64UrlEncode(signature)}`;
  };
  return { jwks, sign };
}

/**
 * A single shared signer so the Worker's module-level JWKS cache (which
 * persists across tests in the same isolate) always resolves to the same
 * public key that signs every test token.
 */
let sharedSigner: TestSigner | null = null;

async function getSharedSigner(): Promise<TestSigner> {
  if (sharedSigner === null) {
    sharedSigner = await createTestSigner();
  }
  return sharedSigner;
}

/**
 * Stub the global fetch so the Worker's JWKS cache resolves to the shared
 * test signer's public keys, then return a valid Access JWT for the operator.
 */
async function stubJwksAndSign(): Promise<string> {
  const { jwks, sign } = await getSharedSigner();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("cloudflareaccess.com/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify(jwks), { status: 200 });
    }
    return new Response("not mocked", { status: 404 });
  });
  const nowSeconds = Math.floor(Date.now() / 1000);
  return sign({
    iss: `https://${TEAM_DOMAIN}`,
    aud: AUDIENCE,
    exp: nowSeconds + 3600,
    nbf: nowSeconds - 60,
    email: OPERATOR.email,
    sub: OPERATOR.sub,
    name: OPERATOR.name,
  });
}

/** Drive an authenticated request through the Worker API. */
async function api(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "Cf-Access-Jwt-Assertion": token,
      ...(init.headers ?? {}),
    },
  });
}

async function seedCustomer(customerId: string): Promise<void> {
  const customer = makeCustomer(customerId);
  await commit(
    customerId,
    (store) => ({ ...store, customers: [...store.customers, customer] }),
    auditFor(
      "customer.created",
      customerId,
      "customer",
      customerId,
      `Created customer "${customer.name}".`,
      customer.createdAt,
      customer
    )
  );
}

async function seedPrepaid(customerId: string): Promise<void> {
  const arrangement = makePrepaid(customerId);
  await commit(
    customerId,
    (store) => ({
      ...store,
      commercialArrangements: [...store.commercialArrangements, arrangement],
    }),
    auditFor(
      "commercial.created",
      customerId,
      "commercial_arrangement",
      arrangement.id,
      "Created prepaid commercial arrangement.",
      arrangement.createdAt,
      arrangement
    )
  );
}

async function seedCredit(
  customerId: string,
  amountTokens: number,
  occurredAt?: string
): Promise<void> {
  const transaction = makeCredit(customerId, amountTokens, occurredAt);
  await commit(
    customerId,
    (store) => ({
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction],
    }),
    auditFor(
      "ledger.credit_grant",
      customerId,
      "ledger_transaction",
      transaction.id,
      `Granted ${transaction.amountTokens} tokens.`,
      transaction.occurredAt,
      transaction
    )
  );
}

/** A customer with an active prepaid arrangement and a 1000-token credit. */
async function seedPrepaidAccount(customerId: string): Promise<void> {
  await seedCustomer(customerId);
  await seedPrepaid(customerId);
  await seedCredit(customerId, 1000);
}

async function countRows(table: string): Promise<number> {
  const row = await db()
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

function prepareSchema(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    })
    .join(" ");
}

beforeEach(async () => {
  // Drop triggers so we can DELETE
  await db().exec(`
    DROP TRIGGER IF EXISTS ledger_transactions_no_delete;
    DROP TRIGGER IF EXISTS usage_records_no_delete;
    DROP TRIGGER IF EXISTS audit_entries_no_delete;
    DROP TRIGGER IF EXISTS customers_no_delete_with_dependents;
  `);
  // Clean tables between tests
  const tables = [
    "audit_entries",
    "usage_records",
    "ledger_transactions",
    "activity_events",
    "agent_access_grants",
    "commercial_arrangements",
    "feature_entitlements",
    "agent_products",
    "customers",
  ];
  for (const table of tables) {
    try {
      await db().exec(`DELETE FROM ${table}`);
    } catch (e) {
      // no such table yet
    }
  }
  // Re-apply schema to restore triggers and tables
  await db().exec(prepareSchema(schemaSql));
  // Seed the catalog so foreign keys pass
  await seedCatalog(db());
});

describe("schema setup", () => {
  it("creates every table from schema.sql", async () => {
    const result = await db()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all<{ name: string }>();
    const tables = result.results.map((row) => row.name);
    for (const expected of [
      "customers",
      "commercial_arrangements",
      "agent_access_grants",
      "activity_events",
      "ledger_transactions",
      "usage_records",
      "audit_entries",
      "feature_entitlements",
      "agent_products",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("creates the append-only and immutability triggers", async () => {
    const result = await db()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"
      )
      .all<{ name: string }>();
    const triggers = result.results.map((row) => row.name);
    for (const expected of [
      "ledger_transactions_no_update",
      "ledger_transactions_no_delete",
      "usage_records_no_update",
      "usage_records_no_delete",
      "audit_entries_no_update",
      "audit_entries_no_delete",
      "customers_no_delete_with_dependents",
    ]) {
      expect(triggers).toContain(expected);
    }
  });

  it("seeds the agent catalog idempotently", async () => {
    await seedCatalog(db());
    const first = await countRows("agent_products");
    expect(first).toBeGreaterThan(0);

    await seedCatalog(db());
    const second = await countRows("agent_products");
    expect(second).toBe(first);
  });
});

describe("financial batch rollback", () => {
  it("rolls back the whole batch when one statement violates a CHECK constraint", async () => {
    const customerId = "cust_rollback_check";
    const customer = makeCustomer(customerId);
    // A credit_grant must be positive; -5 violates the schema CHECK.
    const invalidCredit = makeCredit(customerId, -5, T1);

    const before = await loadCustomerStore(db(), customerId);
    const after: DataStore = {
      ...before,
      customers: [...before.customers, customer],
      ledgerTransactions: [...before.ledgerTransactions, invalidCredit],
    };
    const diff = diffStores(before, after);
    const audit = auditFor(
      "customer.created",
      customerId,
      "customer",
      customerId,
      "Created customer.",
      customer.createdAt,
      customer
    );

    await expect(commitStoreDiff(db(), diff, audit)).rejects.toThrow();

    // The customer insert in the same batch must have been rolled back too.
    expect(await getCustomer(db(), customerId)).toBeNull();
    expect(await countRows("ledger_transactions")).toBe(0);
    expect(await countRows("audit_entries")).toBe(0);
  });

  it("rolls back the whole batch when the audit entry id collides", async () => {
    const firstId = "cust_rollback_audit_1";
    const secondId = "cust_rollback_audit_2";
    await seedCustomer(firstId);

    // Same action + subjectId + occurredAt produces the same deterministic
    // audit id, so the second batch's audit insert collides with the first.
    const second = makeCustomer(secondId);
    const before = await loadCustomerStore(db(), secondId);
    const after: DataStore = {
      ...before,
      customers: [...before.customers, second],
    };
    const diff = diffStores(before, after);
    const collidingAudit = auditFor(
      "customer.created",
      firstId,
      "customer",
      firstId,
      "Created customer.",
      second.createdAt,
      second
    );

    await expect(commitStoreDiff(db(), diff, collidingAudit)).rejects.toThrow();

    expect(await getCustomer(db(), secondId)).toBeNull();
    expect(await countRows("audit_entries")).toBe(1);
  });
});

describe("negative-balance rejection", () => {
  it("rejects a usage debit that would drive the derived balance negative", async () => {
    const customerId = "cust_negative_usage";
    await seedPrepaidAccount(customerId);

    const before = await loadCustomerStore(db(), customerId);
    expect(() =>
      recordUsage(
        before,
        {
          customerId,
          agentProductId: AGENT_PRODUCT_ID,
          tokenQuantity: 2000,
          sourceReference: "usage-over-balance",
        },
        T1
      )
    ).toThrow(/Insufficient token balance/);

    expect(await countRows("usage_records")).toBe(0);
    expect(await countRows("ledger_transactions")).toBe(1);
  });

  it("rejects a manual adjustment that would drive the derived balance negative", async () => {
    const customerId = "cust_negative_adjustment";
    await seedPrepaidAccount(customerId);

    const before = await loadCustomerStore(db(), customerId);
    expect(() =>
      applyManualAdjustment(
        before,
        {
          customerId,
          amountTokens: -2000,
          reference: "adjustment-over-balance",
          reason: "Test overdraw",
        },
        T1
      )
    ).toThrow(/Insufficient token balance/);

    expect(await countRows("ledger_transactions")).toBe(1);
  });

  it("assertNoNegativeBalance rejects a candidate that would overdraw", async () => {
    const customerId = "cust_negative_guard";
    await seedPrepaidAccount(customerId);

    const before = await loadCustomerStore(db(), customerId);
    expect(() =>
      assertNoNegativeBalance(before.ledgerTransactions, customerId, -1001)
    ).toThrow(/Insufficient token balance/);
    expect(() =>
      assertNoNegativeBalance(before.ledgerTransactions, customerId, -1000)
    ).not.toThrow();
  });
});

describe("idempotency", () => {
  it("replays an exact usage submission without duplicating rows", async () => {
    const customerId = "cust_idempotent_replay";
    await seedPrepaidAccount(customerId);

    const usageInput = {
      customerId,
      agentProductId: AGENT_PRODUCT_ID,
      tokenQuantity: 250,
      sourceReference: "usage-replay-1",
    };
    const first = recordUsage(
      await loadCustomerStore(db(), customerId),
      usageInput,
      T1
    );
    await commit(
      customerId,
      (store) => first.store,
      auditFor(
        "ledger.usage_debit",
        customerId,
        "usage_record",
        first.usage.id,
        "Recorded 250 tokens of usage.",
        T1,
        { usage: first.usage, transaction: first.transaction }
      )
    );

    const after = await loadCustomerStore(db(), customerId);
    const existing = after.usageRecords.find(
      (usage) => usage.sourceReference === usageInput.sourceReference
    );
    expect(existing).toBeDefined();

    const fingerprint = normalizeUsageFingerprint({
      ...usageInput,
      occurredAt: T1,
    });
    expect(fingerprint).not.toBeNull();
    expect(validateUsageIdempotency(existing, fingerprint!)).toBe(true);

    // Re-committing the same rows collides on the primary keys.
    await expect(
      commit(
        customerId,
        (store) => first.store,
        auditFor(
          "ledger.usage_debit",
          customerId,
          "usage_record",
          first.usage.id,
          "Recorded 250 tokens of usage.",
          T1,
          { usage: first.usage, transaction: first.transaction }
        )
      )
    ).rejects.toThrow();

    expect(await countRows("usage_records")).toBe(1);
    expect(await countRows("ledger_transactions")).toBe(2);
  });

  it("rejects a conflicting reuse of a source reference", async () => {
    const customerId = "cust_idempotent_conflict";
    await seedPrepaidAccount(customerId);

    const usageInput = {
      customerId,
      agentProductId: AGENT_PRODUCT_ID,
      tokenQuantity: 250,
      sourceReference: "usage-conflict-1",
    };
    const first = recordUsage(
      await loadCustomerStore(db(), customerId),
      usageInput,
      T1
    );
    await commit(
      customerId,
      (store) => first.store,
      auditFor(
        "ledger.usage_debit",
        customerId,
        "usage_record",
        first.usage.id,
        "Recorded 250 tokens of usage.",
        T1,
        { usage: first.usage, transaction: first.transaction }
      )
    );

    const after = await loadCustomerStore(db(), customerId);
    const existing = after.usageRecords.find(
      (usage) => usage.sourceReference === usageInput.sourceReference
    );
    const conflictingFingerprint = normalizeUsageFingerprint({
      ...usageInput,
      tokenQuantity: 300,
      occurredAt: T1,
    });
    expect(() =>
      validateUsageIdempotency(existing, conflictingFingerprint!)
    ).toThrow(/already assigned to different usage/);
  });

  it("enforces the UNIQUE(customer_id, source_reference) constraint", async () => {
    const customerId = "cust_idempotent_unique";
    await seedPrepaidAccount(customerId);

    const usageInput = {
      customerId,
      agentProductId: AGENT_PRODUCT_ID,
      tokenQuantity: 250,
      sourceReference: "usage-unique-1",
    };
    const first = recordUsage(
      await loadCustomerStore(db(), customerId),
      usageInput,
      T1
    );
    await commit(
      customerId,
      (store) => first.store,
      auditFor(
        "ledger.usage_debit",
        customerId,
        "usage_record",
        first.usage.id,
        "Recorded 250 tokens of usage.",
        T1,
        { usage: first.usage, transaction: first.transaction }
      )
    );

    // A second usage record with the same (customer, source_reference) but a
    // different id must be rejected by the schema's UNIQUE constraint.
    const duplicate = {
      ...first.usage,
      id: "usage_duplicate_id",
      ledgerTransactionId: "txn_duplicate_id",
    };
    await expect(
      db()
        .prepare(
          "INSERT INTO usage_records (id, customer_id, agent_product_id, occurred_at, token_quantity, source_reference, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          duplicate.id,
          duplicate.customerId,
          duplicate.agentProductId,
          duplicate.occurredAt,
          duplicate.tokenQuantity,
          duplicate.sourceReference,
          duplicate.ledgerTransactionId
        )
        .run()
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe("append-only protection", () => {
  it("rejects UPDATE and DELETE on ledger_transactions", async () => {
    const customerId = "cust_append_ledger";
    await seedPrepaidAccount(customerId);
    const transactions = await listLedgerTransactions(db(), customerId);
    const transactionId = transactions[0].id;

    await expect(
      db()
        .prepare("UPDATE ledger_transactions SET reason = ? WHERE id = ?")
        .bind("tampered", transactionId)
        .run()
    ).rejects.toThrow(/append-only/);

    await expect(
      db()
        .prepare("DELETE FROM ledger_transactions WHERE id = ?")
        .bind(transactionId)
        .run()
    ).rejects.toThrow(/append-only/);
  });

  it("rejects UPDATE and DELETE on usage_records", async () => {
    const customerId = "cust_append_usage";
    await seedPrepaidAccount(customerId);

    const usageInput = {
      customerId,
      agentProductId: AGENT_PRODUCT_ID,
      tokenQuantity: 100,
      sourceReference: "usage-append-1",
    };
    const first = recordUsage(
      await loadCustomerStore(db(), customerId),
      usageInput,
      T1
    );
    await commit(
      customerId,
      (store) => first.store,
      auditFor(
        "ledger.usage_debit",
        customerId,
        "usage_record",
        first.usage.id,
        "Recorded 100 tokens of usage.",
        T1,
        { usage: first.usage, transaction: first.transaction }
      )
    );

    await expect(
      db()
        .prepare("UPDATE usage_records SET token_quantity = ? WHERE id = ?")
        .bind(1, first.usage.id)
        .run()
    ).rejects.toThrow(/append-only/);

    await expect(
      db()
        .prepare("DELETE FROM usage_records WHERE id = ?")
        .bind(first.usage.id)
        .run()
    ).rejects.toThrow(/append-only/);
  });

  it("rejects UPDATE and DELETE on audit_entries", async () => {
    const customerId = "cust_append_audit";
    await seedCustomer(customerId);

    const entries = await db()
      .prepare("SELECT id FROM audit_entries WHERE customer_id = ?")
      .bind(customerId)
      .all<{ id: string }>();
    const auditId = entries.results[0].id;

    await expect(
      db()
        .prepare("UPDATE audit_entries SET summary = ? WHERE id = ?")
        .bind("tampered", auditId)
        .run()
    ).rejects.toThrow(/immutable/);

    await expect(
      db()
        .prepare("DELETE FROM audit_entries WHERE id = ?")
        .bind(auditId)
        .run()
    ).rejects.toThrow(/immutable/);
  });

  it("rejects a store diff that tries to update an immutable ledger row", async () => {
    const customerId = "cust_append_diff";
    await seedPrepaidAccount(customerId);

    const before = await loadCustomerStore(db(), customerId);
    const tampered = before.ledgerTransactions.map((transaction) => ({
      ...transaction,
      reason: "tampered",
    }));
    const after: DataStore = { ...before, ledgerTransactions: tampered };
    const diff = diffStores(before, after);
    const audit = auditFor(
      "ledger.credit_grant",
      customerId,
      "ledger_transaction",
      before.ledgerTransactions[0].id,
      "Tampered credit.",
      T1
    );

    await expect(commitStoreDiff(db(), diff, audit)).rejects.toThrow(
      /append-only/
    );
  });
});

describe("stale revision conflicts", () => {
  it("rejects a commit built from a stale snapshot that mutates an immutable row", async () => {
    const customerId = "cust_stale_update";
    await seedPrepaidAccount(customerId);

    // Snapshot the store before the next mutation.
    const stale = await loadCustomerStore(db(), customerId);

    // A concurrent mutation appends a credit.
    await seedCredit(customerId, 500, T1);

    // The stale snapshot now tries to "update" the original credit row.
    const tampered = stale.ledgerTransactions.map((transaction) => ({
      ...transaction,
      reason: "stale edit",
    }));
    const after: DataStore = { ...stale, ledgerTransactions: tampered };
    const diff = diffStores(stale, after);
    const audit = auditFor(
      "ledger.credit_grant",
      customerId,
      "ledger_transaction",
      stale.ledgerTransactions[0].id,
      "Stale edit.",
      T1
    );

    await expect(commitStoreDiff(db(), diff, audit)).rejects.toThrow(
      /append-only/
    );
  });

  it("rejects a stale snapshot that re-inserts an already committed row", async () => {
    const customerId = "cust_stale_reinsert";
    await seedPrepaidAccount(customerId);

    const stale = await loadCustomerStore(db(), customerId);
    const credit = makeCredit(customerId, 500, T1);
    await commit(
      customerId,
      (store) => ({
        ...store,
        ledgerTransactions: [...store.ledgerTransactions, credit],
      }),
      auditFor(
        "ledger.credit_grant",
        customerId,
        "ledger_transaction",
        credit.id,
        "Granted 500 tokens.",
        credit.occurredAt,
        credit
      )
    );

    // The stale snapshot (taken before the credit) re-inserts the same row.
    const after: DataStore = {
      ...stale,
      ledgerTransactions: [...stale.ledgerTransactions, credit],
    };
    const diff = diffStores(stale, after);
    const audit = auditFor(
      "ledger.credit_grant",
      customerId,
      "ledger_transaction",
      credit.id,
      "Granted 500 tokens.",
      credit.occurredAt,
      credit
    );

    await expect(commitStoreDiff(db(), diff, audit)).rejects.toThrow();
    expect(await countRows("ledger_transactions")).toBe(2);
  });

  it("rejects hard-deleting a customer that has dependent records", async () => {
    const customerId = "cust_stale_delete";
    await seedPrepaidAccount(customerId);

    await expect(
      db()
        .prepare("DELETE FROM customers WHERE id = ?")
        .bind(customerId)
        .run()
    ).rejects.toThrow(/archive instead/);

    expect(await getCustomer(db(), customerId)).not.toBeNull();
  });
});

describe("archival", () => {
  /** Seed a prepaid account plus an access grant and a usage record. */
  async function seedArchivableAccount(customerId: string): Promise<void> {
    await seedPrepaidAccount(customerId);

    // Grant access to the catalog agent product.
    const grant: AgentAccessGrant = {
      id: `grant_${customerId}_${AGENT_PRODUCT_ID}`,
      customerId,
      agentProductId: AGENT_PRODUCT_ID,
      startsAt: T0,
      endsAt: null,
      createdAt: T0,
      revokedAt: null,
      scheduledRevokeAt: null,
      activityEventId: `evt_grant_${customerId}_${AGENT_PRODUCT_ID}`,
      reasonForChange: "Initial access.",
    };
    await commit(
      customerId,
      (store) => ({
        ...store,
        agentAccessGrants: [...store.agentAccessGrants, grant],
        activityEvents: [
          ...store.activityEvents,
          {
            id: grant.activityEventId,
            occurredAt: T0,
            source: "operator",
            type: "access.granted",
            customerId,
            label: `Granted access to agent product "${AGENT_PRODUCT_ID}".`,
            subjectId: grant.id,
            subjectId2: AGENT_PRODUCT_ID,
            resultingState: "active",
          },
        ],
      }),
      auditFor(
        "access.granted",
        customerId,
        "agent_access_grant",
        grant.id,
        `Granted access to agent product "${AGENT_PRODUCT_ID}".`,
        T0,
        grant
      )
    );

    // Record usage so a usage_debit and its linked usage record exist.
    const usage = recordUsage(
      await loadCustomerStore(db(), customerId),
      {
        customerId,
        agentProductId: AGENT_PRODUCT_ID,
        tokenQuantity: 100,
        sourceReference: `usage-archival-${customerId}`,
      },
      T1
    );
    await commit(
      customerId,
      (store) => usage.store,
      auditFor(
        "ledger.usage_debit",
        customerId,
        "usage_record",
        usage.usage.id,
        "Recorded 100 tokens of usage.",
        T1,
        { usage: usage.usage, transaction: usage.transaction }
      )
    );
  }

  it("archive retains linked data", async () => {
    const customerId = "cust_archive_retain";
    await seedArchivableAccount(customerId);
    const token = await stubJwksAndSign();

    const archiveResponse = await api(
      `/api/customers/${customerId}/archive`,
      token,
      { method: "POST", body: JSON.stringify({ occurredAt: T1 }) }
    );
    expect(archiveResponse.status).toBe(200);
    const archived = (await archiveResponse.json()) as { customer: Customer };
    expect(archived.customer.status).toBe("archived");

    // The customer row is retained (not hard-deleted) and still readable.
    const customer = await getCustomer(db(), customerId);
    expect(customer).not.toBeNull();
    expect(customer?.status).toBe("archived");

    // Every dependent record remains readable after archiving.
    const store = await loadCustomerStore(db(), customerId);
    expect(store.commercialArrangements).toHaveLength(1);
    expect(store.agentAccessGrants).toHaveLength(1);
    expect(store.ledgerTransactions).toHaveLength(2); // credit + usage debit
    expect(store.usageRecords).toHaveLength(1);
    expect(store.activityEvents).toHaveLength(2); // access.granted + customer.archived
    expect(await countRows("audit_entries")).toBeGreaterThan(0);
  });

  it("archived customer rejects prohibited mutations", async () => {
    const customerId = "cust_archive_reject";
    await seedArchivableAccount(customerId);
    const token = await stubJwksAndSign();

    const archiveResponse = await api(
      `/api/customers/${customerId}/archive`,
      token,
      { method: "POST", body: JSON.stringify({ occurredAt: T1 }) }
    );
    expect(archiveResponse.status).toBe(200);

    const ledgerBefore = await countRows("ledger_transactions");
    const usageBefore = await countRows("usage_records");
    const grantsBefore = await countRows("agent_access_grants");

    const mutations: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: `/api/customers/${customerId}/ledger/usage`,
        body: {
          agentProductId: AGENT_PRODUCT_ID,
          sourceReference: "usage-archived-reject",
          tokenQuantity: 50,
          occurredAt: T1,
        },
      },
      {
        path: `/api/customers/${customerId}/ledger/credit`,
        body: { amountTokens: 500, reference: "credit-archived-reject", occurredAt: T1 },
      },
      {
        path: `/api/customers/${customerId}/ledger/adjustment`,
        body: {
          amountTokens: 100,
          reference: "adjustment-archived-reject",
          reason: "Rejected on archived customer.",
          occurredAt: T1,
        },
      },
      {
        path: `/api/customers/${customerId}/ledger/reversal`,
        body: {
          transactionId: "txn_does_not_matter",
          reference: "reversal-archived-reject",
          reason: "Rejected on archived customer.",
          occurredAt: T1,
        },
      },
      {
        path: `/api/customers/${customerId}/access`,
        body: {
          agentProductId: AGENT_PRODUCT_ID,
          startsAt: T1,
          reasonForChange: "Rejected on archived customer.",
          occurredAt: T1,
        },
      },
    ];

    for (const mutation of mutations) {
      const response = await api(mutation.path, token, {
        method: "POST",
        body: JSON.stringify(mutation.body),
      });
      expect(response.status).toBe(409);
      const payload = (await response.json()) as {
        error: { code: string; message: string };
      };
      expect(payload.error.code).toBe("conflict");
      expect(payload.error.message).toMatch(/archived/);
    }

    // No prohibited mutation wrote anything.
    expect(await countRows("ledger_transactions")).toBe(ledgerBefore);
    expect(await countRows("usage_records")).toBe(usageBefore);
    expect(await countRows("agent_access_grants")).toBe(grantsBefore);
  });
});