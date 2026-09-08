/**
 * Small formatting helpers used across screens.
 */

import { differenceInYears, format } from "date-fns";

export function formatDate(iso: string): string {
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return format(new Date(iso), "MMM d, yyyy · HH:mm");
  } catch {
    return iso;
  }
}

/**
 * Deterministic initials from a name, e.g. "Northwind Trading" -> "NT".
 */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Deterministic hue (0-360) derived from a stable id string, used to build
 * subtle avatar colors that stay consistent across renders.
 */
export function hueFromString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * Human friendly "age" of a customer from its createdAt date.
 */
export function customerAge(createdAt: string, now: Date = new Date()): string {
  const years = differenceInYears(now, new Date(createdAt));
  if (years < 1) {
    return "new customer";
  }
  return `${years} ${years === 1 ? "year" : "years"}`;
}

/**
 * Deterministic id generator for new customer records.
 */
export function makeCustomerId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "customer";
  return `cust_${slug}`;
}
