import type {
  ActivityEvent,
  AgentAccessGrant,
  AgentLicense,
  AgentProduct,
  CommercialArrangement,
  Customer,
  CustomerStatus,
  DataStore,
  FeatureEntitlement,
  LedgerTransaction,
  MonthlyCommercialArrangement,
  PlanTier,
  Subscription,
  UsageRecord,
} from "@/domain/types";
import { STORE_SCHEMA_VERSION } from "@/domain/types";
import { subscriptionToMonthlyArrangement } from "@/domain/commercial-rules";
import {
  creditGrantTransactionId,
  openingCreditReference,
  openingCreditTransactionId,
  reversalTransactionId,
  usageDebitTransactionId,
  usageRecordId,
} from "@/domain/ledger-rules";

/**
 * Deterministic seed data for the Hivarium Operator Console.
 *
 * All records are fictional and fully static so the app (and its tests) are
 * reproducible. Exactly six customers are seeded. The store is authored
 * directly in the canonical schemaVersion 3 shape: legacy `Subscription` and
 * `AgentLicense` records are migration inputs only and are never part of the
 * active store.
 */

export interface CustomerSeed {
  customer: Customer;
  commercialArrangements: CommercialArrangement[];
  agentAccessGrants: AgentAccessGrant[];
  activityEvents: ActivityEvent[];
  featureEntitlements: FeatureEntitlement[];
  ledgerTransactions: LedgerTransaction[];
  usageRecords: UsageRecord[];
}

export const PLAN_LABELS: Record<PlanTier, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
  enterprise: "Enterprise",
};

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  evaluation: "Evaluation",
  active: "Active",
  paused: "Paused",
  churned: "Archived",
};

export const STATUS_BADGE_CLASS: Record<CustomerStatus, string> = {
  evaluation: "border-gold/40 text-gold bg-gold-soft",
  active: "border-sage/40 text-sage bg-sage-soft",
  paused: "border-border text-muted-foreground bg-muted",
  churned: "border-destructive/30 text-destructive bg-destructive/10",
};

/**
 * Read-only agent catalog. These products reference the agents that Hivarium
 * sells to customers. They are static (catalog content is versioned in a
 * separate repo) and therefore part of the seed.
 */
export const AGENT_PRODUCTS: AgentProduct[] = [
  {
    id: "agent_sentinel",
    name: "Sentinel",
    description:
      "Autonomous security triage agent that monitors telemetry, triages alerts, and opens incidents with a proposed response plan.",
    category: "Security",
    version: "2.4.1",
    plans: ["growth", "scale", "enterprise"],
  },
  {
    id: "agent_courier",
    name: "Courier",
    description:
      "Order fulfilment agent that coordinates warehouse picking, carrier selection and delivery exceptions end-to-end.",
    category: "Operations",
    version: "3.1.0",
    plans: ["starter", "growth", "scale", "enterprise"],
  },
  {
    id: "agent_ledger",
    name: "Ledger",
    description:
      "Finance reconciliation agent that matches invoices, detects anomalies and posts corrections with an audit trail.",
    category: "Finance",
    version: "1.9.2",
    plans: ["scale", "enterprise"],
  },
  {
    id: "agent_atlas",
    name: "Atlas",
    description:
      "Data platform agent that monitors pipelines, auto-remediates schema drift and surfaces cost anomalies.",
    category: "Data",
    version: "4.0.0",
    plans: ["scale", "enterprise"],
  },
  {
    id: "agent_mercator",
    name: "Mercator",
    description:
      "Support triage agent that routes tickets, drafts first responses and escalates to human operators with full context.",
    category: "Customer Care",
    version: "2.2.8",
    plans: ["starter", "growth", "scale", "enterprise"],
  },
  {
    id: "agent_vanguard",
    name: "Vanguard",
    description:
      "SRE on-call agent that investigates production incidents, gathers evidence and recommends mitigation playbooks.",
    category: "Reliability",
    version: "1.4.0",
    plans: ["enterprise"],
  },
];

/**
 * Fixed reference "now" for the deterministic seed. All as-of projections in
 * the demo resolve against this instant.
 */
export const SEED_NOW = "2026-09-09T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Canonical record builders (legacy seed records are the migration inputs)
// ---------------------------------------------------------------------------

function monthlyFromSubscription(
  subscription: Subscription
): MonthlyCommercialArrangement {
  return subscriptionToMonthlyArrangement(
    {
      id: `arr_${subscription.id}`,
      customerId: subscription.customerId,
      plan: subscription.plan,
      seats: subscription.seats,
      startedAt: subscription.startedAt,
      renewsAt: subscription.renewsAt,
      status: subscription.status,
    },
    { now: SEED_NOW }
  );
}

function grantFromLicense(license: AgentLicense): AgentAccessGrant {
  const revokedAt =
    license.status === "revoked"
      ? (license.expiresAt ?? license.issuedAt)
      : null;
  return {
    id: `grant_${license.id}`,
    customerId: license.customerId,
    agentProductId: license.agentProductId,
    startsAt: license.issuedAt,
    endsAt: license.expiresAt,
    createdAt: SEED_NOW,
    revokedAt,
    scheduledRevokeAt: null,
    activityEventId: `evt_migrate_${license.id}`,
    reasonForChange: `Migrated from legacy ${license.status} license.`,
  };
}

function migrationEventForSubscription(
  subscription: Subscription,
  arrangement: MonthlyCommercialArrangement
): ActivityEvent {
  return {
    id: `evt_migrate_${subscription.id}`,
    occurredAt: SEED_NOW,
    source: "migration",
    type: "commercial.created",
    customerId: subscription.customerId,
    label: `Migrated ${subscription.plan} subscription to a monthly arrangement.`,
    subjectId: arrangement.id,
    resultingState: arrangement.status,
  };
}

function migrationEventForLicense(
  license: AgentLicense,
  grant: AgentAccessGrant
): ActivityEvent {
  const revoked = license.status === "revoked";
  return {
    id: `evt_migrate_${license.id}`,
    occurredAt: SEED_NOW,
    source: "migration",
    type: revoked ? "access.revoked" : "access.granted",
    customerId: license.customerId,
    label: `Migrated ${license.status} license to an agent access grant.`,
    subjectId: grant.id,
    subjectId2: license.agentProductId,
    resultingState: revoked ? "revoked" : "active",
  };
}

function seedCustomer(
  customer: Customer,
  featureEntitlements: FeatureEntitlement[],
  subscriptions: Subscription[],
  agentLicenses: AgentLicense[],
  extraArrangements: CommercialArrangement[] = [],
  extraEvents: ActivityEvent[] = [],
  extraGrants: AgentAccessGrant[] = [],
  extraLedgerTransactions: LedgerTransaction[] = [],
  extraUsageRecords: UsageRecord[] = []
): CustomerSeed {
  const commercialArrangements: MonthlyCommercialArrangement[] =
    subscriptions.map(monthlyFromSubscription);
  const agentAccessGrants: AgentAccessGrant[] = [
    ...agentLicenses.map(grantFromLicense),
    ...extraGrants,
  ];
  const activityEvents: ActivityEvent[] = [
    ...subscriptions.map((subscription, index) =>
      migrationEventForSubscription(
        subscription,
        commercialArrangements[index]
      )
    ),
    ...agentLicenses.map((license, index) =>
      migrationEventForLicense(license, agentAccessGrants[index])
    ),
    ...extraEvents,
  ];
  return {
    customer,
    featureEntitlements,
    commercialArrangements: [...commercialArrangements, ...extraArrangements],
    agentAccessGrants,
    activityEvents,
    ledgerTransactions: extraLedgerTransactions,
    usageRecords: extraUsageRecords,
  };
}

export const SEED_CUSTOMERS: CustomerSeed[] = [
  seedCustomer(
    {
      id: "cust_northwind",
      name: "Northwind Trading",
      domain: "northwind.example",
      contact: "Ingrid Halvorsen",
      email: "ingrid.halvorsen@northwind.example",
      status: "active",
      notes:
        "Strategic retail account. Renewal negotiation scheduled for Q4. Careful about seat counts.",
      createdAt: "2023-03-14T09:30:00.000Z",
    },
    [
      {
        id: "fe_northwind_sso",
        customerId: "cust_northwind",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2023-03-14T09:30:00.000Z",
        expiresAt: null,
      },
      {
        id: "fe_northwind_webhooks",
        customerId: "cust_northwind",
        feature: "webhooks",
        description: "Outbound webhooks for agent lifecycle events.",
        grantedAt: "2023-04-02T10:15:00.000Z",
        expiresAt: null,
      },
    ],
    [
      {
        id: "sub_northwind_courier_growth",
        customerId: "cust_northwind",
        plan: "growth",
        agentProductId: "agent_courier",
        seats: 25,
        startedAt: "2023-03-14T09:30:00.000Z",
        renewsAt: "2026-03-14T09:30:00.000Z",
        status: "active",
      },
      {
        id: "sub_northwind_mercator_growth",
        customerId: "cust_northwind",
        plan: "growth",
        agentProductId: "agent_mercator",
        seats: 40,
        startedAt: "2023-06-01T12:00:00.000Z",
        renewsAt: "2026-06-01T12:00:00.000Z",
        status: "active",
      },
    ],
    [
      {
        id: "lic_northwind_courier",
        customerId: "cust_northwind",
        agentProductId: "agent_courier",
        seats: 25,
        issuedAt: "2023-03-14T09:30:00.000Z",
        expiresAt: "2027-03-14T09:30:00.000Z",
        status: "active",
      },
      {
        id: "lic_northwind_mercator",
        customerId: "cust_northwind",
        agentProductId: "agent_mercator",
        seats: 40,
        issuedAt: "2023-06-01T12:00:00.000Z",
        expiresAt: "2027-06-01T12:00:00.000Z",
        status: "active",
      },
    ]
  ),
  seedCustomer(
    {
      id: "cust_bluepeak",
      name: "Bluepeak Logistics",
      domain: "bluepeak.example",
      contact: "Marcus Oyelaran",
      email: "marcus.oyelaran@bluepeak.example",
      status: "active",
      notes:
        "High-volume logistics account. Runs Courier at scale across 12 regions; sensitive to latency SLAs.",
      createdAt: "2022-11-02T14:00:00.000Z",
    },
    [
      {
        id: "fe_bluepeak_sso",
        customerId: "cust_bluepeak",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2022-11-02T14:00:00.000Z",
        expiresAt: null,
      },
      {
        id: "fe_bluepeak_audit_log",
        customerId: "cust_bluepeak",
        feature: "audit_log",
        description: "24-month immutable audit log export.",
        grantedAt: "2023-01-20T11:00:00.000Z",
        expiresAt: null,
      },
      {
        id: "fe_bluepeak_priority",
        customerId: "cust_bluepeak",
        feature: "priority_support",
        description: "24x7 priority support channel with a named TAM.",
        grantedAt: "2024-02-15T08:00:00.000Z",
        expiresAt: "2026-02-15T08:00:00.000Z",
      },
    ],
    [
      {
        id: "sub_bluepeak_courier_enterprise",
        customerId: "cust_bluepeak",
        plan: "enterprise",
        agentProductId: "agent_courier",
        seats: 200,
        startedAt: "2022-11-02T14:00:00.000Z",
        renewsAt: "2026-11-02T14:00:00.000Z",
        status: "active",
      },
      {
        id: "sub_bluepeak_vanguard_enterprise",
        customerId: "cust_bluepeak",
        plan: "enterprise",
        agentProductId: "agent_vanguard",
        seats: 12,
        startedAt: "2024-02-15T08:00:00.000Z",
        renewsAt: "2026-02-15T08:00:00.000Z",
        status: "active",
      },
    ],
    [
      {
        id: "lic_bluepeak_courier",
        customerId: "cust_bluepeak",
        agentProductId: "agent_courier",
        seats: 200,
        issuedAt: "2022-11-02T14:00:00.000Z",
        expiresAt: "2026-11-02T14:00:00.000Z",
        status: "active",
      },
      {
        id: "lic_bluepeak_vanguard",
        customerId: "cust_bluepeak",
        agentProductId: "agent_vanguard",
        seats: 12,
        issuedAt: "2024-02-15T08:00:00.000Z",
        expiresAt: "2026-02-15T08:00:00.000Z",
        status: "expiring",
      },
    ]
  ),
  seedCustomer(
    {
      id: "cust_sablefin",
      name: "Sable & Finch",
      domain: "sablefinch.example",
      contact: "Priya Raman",
      email: "priya.raman@sablefinch.example",
      status: "evaluation",
      notes:
        "Fashion retailer evaluating Sentinel across two stores; alert-triage accuracy trial.",
      createdAt: "2026-07-28T16:20:00.000Z",
    },
    [
      {
        id: "fe_sablefin_sso",
        customerId: "cust_sablefin",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2026-07-28T16:20:00.000Z",
        expiresAt: "2026-08-27T16:20:00.000Z",
      },
    ],
    [
      {
        id: "sub_sablefin_sentinel_trial",
        customerId: "cust_sablefin",
        plan: "growth",
        agentProductId: "agent_sentinel",
        seats: 8,
        startedAt: "2026-07-28T16:20:00.000Z",
        renewsAt: "2026-08-27T16:20:00.000Z",
        status: "trialing",
      },
    ],
    [
      {
        id: "lic_sablefin_sentinel",
        customerId: "cust_sablefin",
        agentProductId: "agent_sentinel",
        seats: 8,
        issuedAt: "2026-07-28T16:20:00.000Z",
        expiresAt: "2026-08-27T16:20:00.000Z",
        status: "expiring",
      },
    ]
  ),
  seedCustomer(
    {
      id: "cust_orbitalworks",
      name: "Orbital Works",
      domain: "orbitalworks.example",
      contact: "Kenji Watanabe",
      email: "kenji.watanabe@orbitalworks.example",
      status: "active",
      notes:
        "Aerospace hardware manufacturer. Enterprise tier with Atlas for the data platform; expanding seat count in Q3.",
      createdAt: "2021-05-19T07:45:00.000Z",
    },
    [
      {
        id: "fe_orbitalworks_sso",
        customerId: "cust_orbitalworks",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2021-05-19T07:45:00.000Z",
        expiresAt: null,
      },
      {
        id: "fe_orbitalworks_audit_log",
        customerId: "cust_orbitalworks",
        feature: "audit_log",
        description: "24-month immutable audit log export.",
        grantedAt: "2022-01-05T09:00:00.000Z",
        expiresAt: null,
      },
      {
        id: "fe_orbitalworks_webhooks",
        customerId: "cust_orbitalworks",
        feature: "webhooks",
        description: "Outbound webhooks for agent lifecycle events.",
        grantedAt: "2022-01-05T09:00:00.000Z",
        expiresAt: null,
      },
      {
        id: "fe_orbitalworks_priority",
        customerId: "cust_orbitalworks",
        feature: "priority_support",
        description: "24x7 priority support channel with a named TAM.",
        grantedAt: "2021-05-19T07:45:00.000Z",
        expiresAt: null,
      },
    ],
    [
      {
        id: "sub_orbitalworks_atlas_enterprise",
        customerId: "cust_orbitalworks",
        plan: "enterprise",
        agentProductId: "agent_atlas",
        seats: 75,
        startedAt: "2021-05-19T07:45:00.000Z",
        renewsAt: "2026-05-19T07:45:00.000Z",
        status: "active",
      },
      {
        id: "sub_orbitalworks_ledger_scale",
        customerId: "cust_orbitalworks",
        plan: "scale",
        agentProductId: "agent_ledger",
        seats: 15,
        startedAt: "2023-09-10T10:00:00.000Z",
        renewsAt: "2026-09-10T10:00:00.000Z",
        status: "active",
      },
    ],
    [
      {
        id: "lic_orbitalworks_atlas",
        customerId: "cust_orbitalworks",
        agentProductId: "agent_atlas",
        seats: 75,
        issuedAt: "2021-05-19T07:45:00.000Z",
        expiresAt: "2026-05-19T07:45:00.000Z",
        status: "active",
      },
      {
        id: "lic_orbitalworks_ledger",
        customerId: "cust_orbitalworks",
        agentProductId: "agent_ledger",
        seats: 15,
        issuedAt: "2023-09-10T10:00:00.000Z",
        expiresAt: "2026-09-10T10:00:00.000Z",
        status: "active",
      },
    ]
  ),
  seedCustomer(
    {
      id: "cust_meridians",
      name: "Meridians Health",
      domain: "meridians.example",
      contact: "Dr. Amara Osei",
      email: "amara.osei@meridians.example",
      status: "paused",
      notes:
        "Healthcare network paused during a system consolidation. Contract is valid; expect reactivation in two quarters.",
      createdAt: "2022-04-11T13:00:00.000Z",
    },
    [
      {
        id: "fe_meridians_sso",
        customerId: "cust_meridians",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2022-04-11T13:00:00.000Z",
        expiresAt: null,
      },
      {
        id: "fe_meridians_webhooks",
        customerId: "cust_meridians",
        feature: "webhooks",
        description: "Outbound webhooks for agent lifecycle events.",
        grantedAt: "2022-08-01T09:00:00.000Z",
        expiresAt: null,
      },
    ],
    [
      {
        id: "sub_meridians_mercator_scale",
        customerId: "cust_meridians",
        plan: "scale",
        agentProductId: "agent_mercator",
        seats: 60,
        startedAt: "2022-04-11T13:00:00.000Z",
        renewsAt: "2026-04-11T13:00:00.000Z",
        status: "cancelled",
      },
    ],
    [
      {
        id: "lic_meridians_mercator",
        customerId: "cust_meridians",
        agentProductId: "agent_mercator",
        seats: 60,
        issuedAt: "2022-04-11T13:00:00.000Z",
        expiresAt: "2026-04-11T13:00:00.000Z",
        status: "expired",
      },
    ],
    [
      {
        id: "arr_meridians_prepaid",
        customerId: "cust_meridians",
        status: "active",
        model: "prepaid",
        warningThresholdTokens: 100,
        effectiveFrom: "2026-04-11T13:00:00.000Z",
        effectiveTo: null,
        replacedByArrangementId: null,
        expiresAt: null,
        createdAt: "2026-04-11T13:00:00.000Z",
        reason: "Prepaid balance loaded during the consolidation pause.",
      },
      {
        id: "arr_meridians_monthly_scheduled",
        customerId: "cust_meridians",
        status: "scheduled",
        model: "monthly",
        currency: "USD",
        billingCadence: "monthly",
        monthlyAmountCents: 14900,
        effectiveFrom: "2026-12-01T00:00:00.000Z",
        effectiveTo: null,
        replacedByArrangementId: null,
        renewsAt: "2027-12-01T00:00:00.000Z",
        createdAt: "2026-09-01T09:00:00.000Z",
        reason: "Scheduled migration from prepaid balance to monthly subscription.",
      },
    ],
    [
      {
        id: "evt_meridians_prepaid",
        occurredAt: "2026-04-11T13:00:00.000Z",
        source: "operator",
        type: "commercial.created",
        customerId: "cust_meridians",
        label: "Activated prepaid balance.",
        subjectId: "arr_meridians_prepaid",
        resultingState: "active",
      },
      {
        id: "evt_arr_meridians_monthly_scheduled",
        occurredAt: "2026-09-01T09:00:00.000Z",
        source: "operator",
        type: "commercial.created",
        customerId: "cust_meridians",
        label: "Scheduled monthly subscription after prepaid balance.",
        subjectId: "arr_meridians_monthly_scheduled",
        resultingState: "scheduled",
      },
      {
        id: "evt_grant_meridians_sentinel",
        occurredAt: "2026-08-01T00:00:00.000Z",
        source: "operator",
        type: "access.granted",
        customerId: "cust_meridians",
        label: "Granted access to agent product \"agent_sentinel\".",
        subjectId: "grant_meridians_sentinel",
        subjectId2: "agent_sentinel",
        resultingState: "active",
      },
    ],
    [
      {
        id: "grant_meridians_sentinel",
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        revokedAt: null,
        scheduledRevokeAt: "2026-10-01T00:00:00.000Z",
        activityEventId: "evt_grant_meridians_sentinel",
        reasonForChange: "Scheduled revocation during consolidation review.",
      },
    ],
    [
      {
        id: openingCreditTransactionId("arr_meridians_prepaid"),
        customerId: "cust_meridians",
        occurredAt: "2026-04-11T13:00:00.000Z",
        kind: "credit_grant",
        amountTokens: 250000,
        reason: "Opening token credit from prototype migration",
        reference: openingCreditReference("arr_meridians_prepaid"),
      },
      {
        id: usageDebitTransactionId("usage_meridians_may_001"),
        customerId: "cust_meridians",
        occurredAt: "2026-05-14T09:15:00.000Z",
        kind: "usage_debit",
        amountTokens: -1200,
        reason: "Agent usage.",
        reference: "usage_meridians_may_001",
        usageRecordId: usageRecordId("usage_meridians_may_001"),
        agentProductId: "agent_sentinel",
      },
      {
        id: usageDebitTransactionId("usage_meridians_jun_002"),
        customerId: "cust_meridians",
        occurredAt: "2026-06-02T14:30:00.000Z",
        kind: "usage_debit",
        amountTokens: -800,
        reason: "Agent usage.",
        reference: "usage_meridians_jun_002",
        usageRecordId: usageRecordId("usage_meridians_jun_002"),
        agentProductId: "agent_mercator",
      },
      {
        id: usageDebitTransactionId("usage_meridians_jun_003"),
        customerId: "cust_meridians",
        occurredAt: "2026-06-20T11:00:00.000Z",
        kind: "usage_debit",
        amountTokens: -1500,
        reason: "Agent usage.",
        reference: "usage_meridians_jun_003",
        usageRecordId: usageRecordId("usage_meridians_jun_003"),
        agentProductId: "agent_sentinel",
      },
      {
        id: reversalTransactionId(usageDebitTransactionId("usage_meridians_jun_003")),
        customerId: "cust_meridians",
        occurredAt: "2026-06-21T08:45:00.000Z",
        kind: "reversal",
        amountTokens: 1500,
        reason: "Reversing duplicate usage debit.",
        reference: "rev_usage_meridians_jun_003",
        reversesTransactionId: usageDebitTransactionId("usage_meridians_jun_003"),
      },
      {
        id: creditGrantTransactionId("cust_meridians", "2026-07-01T09:00:00.000Z"),
        customerId: "cust_meridians",
        occurredAt: "2026-07-01T09:00:00.000Z",
        kind: "credit_grant",
        amountTokens: 2000,
        reason: "Operator-confirmed token credit",
        reference: "credit_meridians_jul_001",
      },
    ],
    [
      {
        id: usageRecordId("usage_meridians_may_001"),
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        occurredAt: "2026-05-14T09:15:00.000Z",
        tokenQuantity: 1200,
        sourceReference: "usage_meridians_may_001",
        ledgerTransactionId: usageDebitTransactionId("usage_meridians_may_001"),
      },
      {
        id: usageRecordId("usage_meridians_jun_002"),
        customerId: "cust_meridians",
        agentProductId: "agent_mercator",
        occurredAt: "2026-06-02T14:30:00.000Z",
        tokenQuantity: 800,
        sourceReference: "usage_meridians_jun_002",
        ledgerTransactionId: usageDebitTransactionId("usage_meridians_jun_002"),
      },
      {
        id: usageRecordId("usage_meridians_jun_003"),
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        occurredAt: "2026-06-20T11:00:00.000Z",
        tokenQuantity: 1500,
        sourceReference: "usage_meridians_jun_003",
        ledgerTransactionId: usageDebitTransactionId("usage_meridians_jun_003"),
      },
    ]
  ),
  seedCustomer(
    {
      id: "cust_greyharbor",
      name: "Grey Harbor Media",
      domain: "greyharbor.example",
      contact: "Sofia Delgado",
      email: "sofia.delgado@greyharbor.example",
      status: "churned",
      notes:
        "Content studio churned last quarter after consolidating vendors. Closeout documentation archived.",
      createdAt: "2021-10-05T15:30:00.000Z",
    },
    [
      {
        id: "fe_greyharbor_sso",
        customerId: "cust_greyharbor",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2021-10-05T15:30:00.000Z",
        expiresAt: null,
      },
    ],
    [
      {
        id: "sub_greyharbor_mercator_growth",
        customerId: "cust_greyharbor",
        plan: "growth",
        agentProductId: "agent_mercator",
        seats: 12,
        startedAt: "2021-10-05T15:30:00.000Z",
        renewsAt: "2025-10-05T15:30:00.000Z",
        status: "cancelled",
      },
    ],
    [
      {
        id: "lic_greyharbor_mercator",
        customerId: "cust_greyharbor",
        agentProductId: "agent_mercator",
        seats: 12,
        issuedAt: "2021-10-05T15:30:00.000Z",
        expiresAt: "2025-10-05T15:30:00.000Z",
        status: "revoked",
      },
    ],
    [
      {
        id: "arr_greyharbor_annual",
        customerId: "cust_greyharbor",
        status: "ended",
        model: "annual",
        currency: "USD",
        contractValueCents: 1200000,
        effectiveFrom: "2021-10-05T15:30:00.000Z",
        effectiveTo: "2024-10-05T15:30:00.000Z",
        replacedByArrangementId: null,
        startsAt: "2021-10-05T15:30:00.000Z",
        endsAt: "2024-10-05T15:30:00.000Z",
        renewalStatus: "non-renewing",
        includedAllowance: 500000,
        allowanceUnit: "tokens",
        overageRateCentsPerUnit: 2,
        createdAt: "2021-10-05T15:30:00.000Z",
        reason: "Annual contract completed at closeout.",
      },
      {
        id: "arr_greyharbor_monthly_terminated",
        customerId: "cust_greyharbor",
        status: "terminated",
        model: "monthly",
        currency: "USD",
        billingCadence: "monthly",
        monthlyAmountCents: 14900,
        effectiveFrom: "2024-10-05T15:30:00.000Z",
        effectiveTo: "2025-06-01T00:00:00.000Z",
        replacedByArrangementId: null,
        renewsAt: "2025-06-01T00:00:00.000Z",
        createdAt: "2024-10-05T15:30:00.000Z",
        reason: "Terminated during vendor consolidation.",
      },
    ],
    [
      {
        id: "evt_greyharbor_annual",
        occurredAt: "2021-10-05T15:30:00.000Z",
        source: "operator",
        type: "commercial.created",
        customerId: "cust_greyharbor",
        label: "Started annual contract.",
        subjectId: "arr_greyharbor_annual",
        resultingState: "ended",
      },
      {
        id: "evt_arr_greyharbor_monthly_terminated",
        occurredAt: "2025-06-01T00:00:00.000Z",
        source: "operator",
        type: "commercial.terminated",
        customerId: "cust_greyharbor",
        label: "Terminated monthly commercial arrangement.",
        subjectId: "arr_greyharbor_monthly_terminated",
        resultingState: "terminated",
      },
      {
        id: "evt_grant_greyharbor_sentinel_revoked",
        occurredAt: "2025-06-01T00:00:00.000Z",
        source: "system",
        type: "access.revoked",
        customerId: "cust_greyharbor",
        label:
          "Access revoked automatically because no commercial arrangement is active.",
        subjectId: "grant_greyharbor_sentinel",
        subjectId2: "agent_sentinel",
        resultingState: "revoked",
        causationId: "evt_arr_greyharbor_monthly_terminated",
      },
    ],
    [
      {
        id: "grant_greyharbor_sentinel",
        customerId: "cust_greyharbor",
        agentProductId: "agent_sentinel",
        startsAt: "2024-10-05T15:30:00.000Z",
        endsAt: null,
        createdAt: "2024-10-05T15:30:00.000Z",
        revokedAt: "2025-06-01T00:00:00.000Z",
        scheduledRevokeAt: null,
        activityEventId: "evt_grant_greyharbor_sentinel",
        reasonForChange: "Revoked automatically after arrangement termination.",
      },
    ]
  ),
];

/**
 * Flattened deterministic seed used by the storage repository at first boot.
 * Conforms strictly to schemaVersion 3.
 */
export function buildSeedStore(): DataStore {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    customers: SEED_CUSTOMERS.map((s) => s.customer),
    featureEntitlements: SEED_CUSTOMERS.flatMap(
      (s) => s.featureEntitlements
    ),
    agentProducts: [...AGENT_PRODUCTS],
    commercialArrangements: SEED_CUSTOMERS.flatMap(
      (s) => s.commercialArrangements
    ),
    agentAccessGrants: SEED_CUSTOMERS.flatMap((s) => s.agentAccessGrants),
    activityEvents: SEED_CUSTOMERS.flatMap((s) => s.activityEvents),
    ledgerTransactions: SEED_CUSTOMERS.flatMap((s) => s.ledgerTransactions),
    usageRecords: SEED_CUSTOMERS.flatMap((s) => s.usageRecords),
  };
}

/**
 * Returns true when the array contains the expected six seeded customers.
 * Useful for assertions in tests.
 */
export function assertSeedCustomers(list: Customer[]): boolean {
  const expected = [
    "cust_northwind",
    "cust_bluepeak",
    "cust_sablefin",
    "cust_orbitalworks",
    "cust_meridians",
    "cust_greyharbor",
  ];
  if (list.length !== 6) return false;
  const ids = list.map((c) => c.id);
  return expected.every((id) => ids.includes(id));
}