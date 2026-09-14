import type {
  CommercialArrangement,
  CustomerRequest,
  LedgerTransactionKind,
} from "@/domain/types";
import { formatDate } from "@/lib/format";

/**
 * Shared presentation helpers for the customer commercial/access surfaces.
 *
 * These are formatting-only helpers (no business rules): the canonical
 * projections and transitions live in the repository and domain rules.
 */

/** USD with two decimals, e.g. `$149.00`. */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Whole tokens with a unit label, e.g. `2,480 tokens` (singular `1 token`).
 * Callers render the value with `tabular-nums` so digits align.
 */
export function formatTokens(tokens: number): string {
  const count = tokens.toLocaleString("en-US");
  return `${count} ${tokens === 1 ? "token" : "tokens"}`;
}

/**
 * Signed whole tokens for statement amounts, e.g. `+250 tokens` or
 * `−250 tokens`. The sign is always explicit (U+2212 minus) so a debit is
 * never conveyed by color or punctuation alone.
 */
export function formatSignedTokens(tokens: number): string {
  const count = Math.abs(tokens).toLocaleString("en-US");
  const sign = tokens < 0 ? "−" : "+";
  return `${sign}${count} ${Math.abs(tokens) === 1 ? "token" : "tokens"}`;
}

/** Human labels for the four immutable ledger transaction kinds. */
export const TRANSACTION_KIND_LABELS: Record<LedgerTransactionKind, string> = {
  credit_grant: "Credit grant",
  usage_debit: "Usage debit",
  manual_adjustment: "Manual adjustment",
  reversal: "Reversal",
};

/**
 * Presentation labels for portal request types. Canonical API/D1 values stay
 * unchanged; this formatter is UI-only.
 */
export function formatRequestType(type: CustomerRequest["type"]): string {
  switch (type) {
    case "license_renewal":
      return "License renewal";
    case "additional_agent_access":
      return "Additional agent access";
    case "token_credit":
      return "Token credit";
    case "plan_change":
      return "Plan change";
    case "support":
      return "Support";
  }
}

/**
 * Safe label for a request type that may be unknown at runtime. Known union
 * values use the exhaustive formatter; anything else is readable, not raw.
 */
export function formatRequestTypeLabel(type: string): string {
  switch (type) {
    case "license_renewal":
    case "additional_agent_access":
    case "token_credit":
    case "plan_change":
    case "support":
      return formatRequestType(type);
    default: {
      const cleaned = type.replace(/[_-]+/g, " ").trim();
      if (!cleaned) return "Unknown request";
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
}

/** Presentation labels for portal request statuses. Canonical values unchanged. */
export function formatRequestStatus(status: CustomerRequest["status"]): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under review";
    case "needs_information":
      return "Needs information";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

export function formatRequestStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
    case "under_review":
    case "needs_information":
    case "approved":
    case "rejected":
    case "completed":
    case "cancelled":
      return formatRequestStatus(status);
    default: {
      const cleaned = status.replace(/[_-]+/g, " ").trim();
      if (!cleaned) return "Unknown status";
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
}

/** Human label for a commercial model. */
export function modelLabel(model: CommercialArrangement["model"]): string {
  switch (model) {
    case "monthly":
      return "Monthly";
    case "prepaid":
      return "Prepaid";
    case "annual":
      return "Annual contract";
  }
}

/**
 * One model-specific primary value for the Overview summary band. Prepaid
 * shows the derived token balance (never a stored USD balance).
 */
export function modelPrimaryValue(
  arrangement: CommercialArrangement,
  prepaidBalanceTokens?: number
): string {
  switch (arrangement.model) {
    case "monthly":
      return `${formatUsd(arrangement.monthlyAmountCents)} / month`;
    case "prepaid":
      return formatTokens(prepaidBalanceTokens ?? 0);
    case "annual":
      return formatUsd(arrangement.contractValueCents);
  }
}

/**
 * One model-specific important date for the Overview summary band. Prepaid
 * shows the configurable warning threshold instead of a stored balance.
 */
export function modelImportantDate(
  arrangement: CommercialArrangement,
  prepaidThresholdTokens?: number
): string {
  switch (arrangement.model) {
    case "monthly":
      return `Renews ${formatDate(arrangement.renewsAt)}`;
    case "prepaid":
      return `Warning at ${formatTokens(
        prepaidThresholdTokens ?? arrangement.warningThresholdTokens
      )} or below`;
    case "annual":
      return `Ends ${formatDate(arrangement.endsAt)}`;
  }
}

/**
 * Minimum interactive target height: 44px on touch layouts (<768px) and 36px
 * on desktop. Applied to primary controls in the Phase 1 surfaces.
 */
export const TOUCH_TARGET = "h-11 md:h-9";