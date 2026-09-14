import { describe, expect, it } from "vitest";
import type { CustomerRequest } from "@/domain/types";
import {
  formatRequestStatus,
  formatRequestStatusLabel,
  formatRequestType,
  formatRequestTypeLabel,
} from "./format";

const REQUEST_TYPES: Array<[CustomerRequest["type"], string]> = [
  ["license_renewal", "License renewal"],
  ["additional_agent_access", "Additional agent access"],
  ["token_credit", "Token credit"],
  ["plan_change", "Plan change"],
  ["support", "Support"],
];

const REQUEST_STATUSES: Array<[CustomerRequest["status"], string]> = [
  ["submitted", "Submitted"],
  ["under_review", "Under review"],
  ["needs_information", "Needs information"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];

describe("formatRequestType", () => {
  it.each(REQUEST_TYPES)("labels %s as %s", (type, label) => {
    expect(formatRequestType(type)).toBe(label);
    expect(formatRequestTypeLabel(type)).toBe(label);
  });

  it("falls back to a readable label for unknown types", () => {
    expect(formatRequestTypeLabel("future_kind")).toBe("Future kind");
    expect(formatRequestTypeLabel("")).toBe("Unknown request");
  });
});

describe("formatRequestStatus", () => {
  it.each(REQUEST_STATUSES)("labels %s as %s", (status, label) => {
    expect(formatRequestStatus(status)).toBe(label);
    expect(formatRequestStatusLabel(status)).toBe(label);
  });

  it("falls back to a readable label for unknown statuses", () => {
    expect(formatRequestStatusLabel("queued_retry")).toBe("Queued retry");
    expect(formatRequestStatusLabel("")).toBe("Unknown status");
  });
});
