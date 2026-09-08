import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string }>;

interface Item {
  icon: IconType;
  label: string;
  values: { value: string; count: number }[];
  accent: "primary" | "gold" | "sage" | "muted";
}

const ACCENT_BG: Record<Item["accent"], string> = {
  primary: "bg-primary-soft text-primary",
  gold: "bg-gold-soft text-gold",
  sage: "bg-sage-soft text-sage",
  muted: "bg-muted text-muted-foreground",
};

/**
 * Row of small stat tiles rendered above tables. Purely presentational —
 * callers compute the counts from the repository.
 */
export function StatRow({ items }: { items: Item[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="grid gap-3"
      data-testid="stat-row"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <StatTile key={item.label} item={item} animated={mounted} />
      ))}
    </div>
  );
}

function StatTile({ item, animated }: { item: Item; animated: boolean }) {
  const Icon = item.icon;
  return (
    <div
      className="bg-card text-card-foreground flex items-center gap-3 rounded-xl border p-4 shadow-sm"
      data-testid={`stat-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-lg",
          ACCENT_BG[item.accent]
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="leading-tight">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums transition-opacity duration-300",
            animated ? "opacity-100" : "opacity-0"
          )}
        >
          {item.values.reduce((sum, v) => sum + v.count, 0)}
        </p>
        <p className="text-muted-foreground text-xs">{item.label}</p>
      </div>
    </div>
  );
}

/**
 * Small circular avatar with deterministic initials. Used in customer rows
 * and profile headers.
 */
export function Avatar({
  name,
  id,
  size = "md",
  className,
}: {
  name: string;
  id: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  const hue = hash;
  const sizeClass = size === "sm" ? "size-8 text-[11px]" : size === "lg" ? "size-12 text-base" : "size-9 text-xs";
  return (
    <span
      aria-hidden="true"
      data-testid="avatar"
      className={cn(
        "inline-flex items-center justify-center rounded-full border font-semibold select-none",
        sizeClass,
        className
      )}
      style={{
        backgroundColor: `hsl(${hue} 45% 92%)`,
        color: `hsl(${hue} 45% 28%)`,
        borderColor: `hsl(${hue} 35% 80%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Reusable table footer with a "back" link and optional action.
 */
export function TableFooter({
  backTo,
  backLabel,
  children,
}: {
  backTo: string;
  backLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="border-border mt-4 flex items-center justify-between gap-3 border-t pt-3 text-sm">
      <Link
        to={backTo}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        ← {backLabel}
      </Link>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}
