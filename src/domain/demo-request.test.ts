import { describe, expect, it } from "vitest";
import {
  DEMO_REQUEST_STATUSES,
  DEMO_STATUS_TRANSITIONS,
  assertTransition,
  canTransition,
  DemoTransitionError,
  defaultProposedConfig,
  domainFromEmail,
  normalizeEmail,
  stableCustomerId,
  type DemoIntakePayload,
  type DemoRequestStatus,
} from "./demo-request";

describe("demo request transitions", () => {
  it("allows every documented legal transition and rejects the rest", () => {
    for (const from of DEMO_REQUEST_STATUSES) {
      for (const to of DEMO_REQUEST_STATUSES) {
        const allowed = DEMO_STATUS_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(allowed);
        if (!allowed) {
          expect(() => assertTransition(from, to)).toThrow(DemoTransitionError);
        }
      }
    }
  });

  it("does not allow approval from submitted without review", () => {
    expect(canTransition("submitted", "approved")).toBe(false);
  });

  it("allows retry only from provisioning_failed", () => {
    expect(canTransition("provisioning_failed", "provisioning")).toBe(true);
    expect(canTransition("active", "provisioning")).toBe(false);
  });
});

describe("demo helpers", () => {
  it("normalizes email and domain", () => {
    expect(normalizeEmail("  Ada@Acme.Example ")).toBe("ada@acme.example");
    expect(domainFromEmail("Ada@Acme.Example")).toBe("acme.example");
  });

  it("derives a stable customer id from the request id", () => {
    expect(stableCustomerId("dreq_abc")).toBe("demo_dreq_abc");
  });

  it("builds a 30-day proposed evaluation configuration", () => {
    const intake: DemoIntakePayload = {
      applicantName: "Ada",
      applicantEmail: "ada@acme.example",
      organizationName: "Acme",
      organizationDomain: "acme.example",
      roleTitle: "CTO",
      useCase: "Evaluate agent governance",
      deploymentPreference: "on_premises",
      expectedAgentCount: "5",
      requestedAgentIds: ["agent_sentinel"],
      infrastructureNotes: "",
      timeline: "",
      additionalDetails: "",
    };
    const proposed = defaultProposedConfig(intake, "2026-09-14T00:00:00.000Z");
    expect(proposed.demoExpiresAt).toBe("2026-10-14T00:00:00.000Z");
    expect(proposed.enabledFeatures).toEqual(["evaluation_workspace"]);
  });
});
