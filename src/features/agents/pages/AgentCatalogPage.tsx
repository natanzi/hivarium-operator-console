import { Boxes } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { PLAN_LABELS } from "@/data/seed-data";
import { useRepository } from "@/data/repository-context";
import type { AgentProduct, PlanTier } from "@/domain/types";

/**
 * Read-only agent catalog screen.
 *
 * Renders every agent product in the repository as a card. The catalog is
 * static (versioned separately) so the screen only reads; it never mutates.
 * Reads flow through the asynchronous {@link HiveRepository}: the page shows
 * a skeleton while loading.
 */
export function AgentCatalogPage() {
  const repo = useRepository();
  const [products, setProducts] = useState<AgentProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void repo.listAgentProducts().then((list) => {
      if (!cancelled) setProducts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agent Catalog"
        id="agents-page-title"
        description="Agent products sold through Hivarium, grouped by category. This catalog is read-only."
      />

      {products === null ? (
        <div className="grid gap-4 md:grid-cols-2" data-testid="agents-loading">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="border-border flex flex-col gap-3 rounded-xl border bg-card p-4"
            >
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div
          className="text-muted-foreground flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center"
          data-testid="agents-empty"
        >
          <Boxes className="size-8" />
          <p className="text-sm">No agent products are available yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {products.map((product) => (
            <AgentProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentProductCard({ product }: { product: AgentProduct }) {
  return (
    <Link
      to={`/agents/${product.id}`}
      className="group focus-visible:ring-ring/50 block rounded-xl focus-visible:ring-[3px] focus-visible:outline-none"
      data-testid={`agent-link-${product.id}`}
      aria-label={`View ${product.name} agent details`}
    >
      <Card
        data-testid={`agent-card-${product.id}`}
        className="group-hover:border-primary/40 h-full transition-colors"
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{product.name}</CardTitle>
            <Badge variant="secondary" className="tabular-nums text-xs">
              v{product.version}
            </Badge>
          </div>
          <CardDescription>{product.category}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-foreground/90 text-sm leading-relaxed">
            {product.description}
          </p>
          <div className="flex flex-wrap gap-1.5" data-testid={`agent-plans-${product.id}`}>
            {product.plans.map((plan) => (
              <PlanBadge key={plan} plan={plan} />
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PlanBadge({ plan }: { plan: PlanTier }) {
  return (
    <span className="text-muted-foreground border-border bg-muted inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
      {PLAN_LABELS[plan]}
    </span>
  );
}
