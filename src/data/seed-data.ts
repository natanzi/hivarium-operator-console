import type {
  AgentLicense,
  AgentProduct,
  Customer,
  CustomerStatus,
  DataStore,
  FeatureEntitlement,
  PlanTier,
  Subscription,
} from "@/domain/types";

/**
 * Deterministic seed data for the Hivarium Operator Console.
 *
 * All records are fictional and fully static so the app (and its tests) are
 * reproducible. Exactly six customers are seeded.
 */

export interface CustomerSeed {
  customer: Customer;
  subscriptions: Subscription[];
  featureEntitlements: FeatureEntitlement[];
  agentLicenses: AgentLicense[];
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

export const SEED_CUSTOMERS: CustomerSeed[] = [
  {
    customer: {
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
    subscriptions: [
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
    featureEntitlements: [
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
    agentLicenses: [
      {
        id: "lic_northwind_courier",
        customerId: "cust_northwind",
        agentProductId: "agent_courier",
        seats: 25,
        issuedAt: "2023-03-14T09:30:00.000Z",
        expiresAt: "2026-03-14T09:30:00.000Z",
        status: "active",
      },
      {
        id: "lic_northwind_mercator",
        customerId: "cust_northwind",
        agentProductId: "agent_mercator",
        seats: 40,
        issuedAt: "2023-06-01T12:00:00.000Z",
        expiresAt: "2026-06-01T12:00:00.000Z",
        status: "active",
      },
    ],
  },
  {
    customer: {
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
    subscriptions: [
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
    featureEntitlements: [
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
    agentLicenses: [
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
    ],
  },
  {
    customer: {
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
    subscriptions: [
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
    featureEntitlements: [
      {
        id: "fe_sablefin_sso",
        customerId: "cust_sablefin",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2026-07-28T16:20:00.000Z",
        expiresAt: "2026-08-27T16:20:00.000Z",
      },
    ],
    agentLicenses: [
      {
        id: "lic_sablefin_sentinel",
        customerId: "cust_sablefin",
        agentProductId: "agent_sentinel",
        seats: 8,
        issuedAt: "2026-07-28T16:20:00.000Z",
        expiresAt: "2026-08-27T16:20:00.000Z",
        status: "expiring",
      },
    ],
  },
  {
    customer: {
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
    subscriptions: [
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
    featureEntitlements: [
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
    agentLicenses: [
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
    ],
  },
  {
    customer: {
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
    subscriptions: [
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
    featureEntitlements: [
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
    agentLicenses: [
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
  },
  {
    customer: {
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
    subscriptions: [
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
    featureEntitlements: [
      {
        id: "fe_greyharbor_sso",
        customerId: "cust_greyharbor",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2021-10-05T15:30:00.000Z",
        expiresAt: null,
      },
    ],
    agentLicenses: [
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
  },
];

/**
 * Flattened deterministic seed used by the storage repository at first boot.
 */
export function buildSeedStore(): DataStore {
  return {
    customers: SEED_CUSTOMERS.map((s) => s.customer),
    subscriptions: SEED_CUSTOMERS.flatMap((s) => s.subscriptions),
    featureEntitlements: SEED_CUSTOMERS.flatMap(
      (s) => s.featureEntitlements
    ),
    agentProducts: [...AGENT_PRODUCTS],
    agentLicenses: SEED_CUSTOMERS.flatMap((s) => s.agentLicenses),
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
