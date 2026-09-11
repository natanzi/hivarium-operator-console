import type { CommercialArrangement } from "@/domain/types";
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
      return `Warning at ${formatTokens(prepaidThresholdTokens ?? 0)} or below`;
    case "annual":
      return `Ends ${formatDate(arrangement.endsAt)}`;
  }
}

/**
 * Minimum interactive target height: 44px on touch layouts (<768px) and 36px
 * on desktop. Applied to primary controls in the Phase 1 surfaces.
 */
export const TOUCH_TARGET = "h-11 md:h-9";