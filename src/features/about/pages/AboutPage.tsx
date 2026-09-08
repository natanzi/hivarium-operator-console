import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/layout/Layout";
import { repository } from "@/data/local-storage-repository";

/**
 * Product information screen.
 *
 * A small, static "about" page that describes what the Hivarium Operator
 * Console is and which Phase 1 surfaces it exposes. The single live number
 * (number of seeded agent products) is read from the shared repository so the
 * page always matches the catalog actually rendered on the Agents screen.
 */
export function AboutPage() {
  const agentProductCount = repository.listAgentProducts().length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="About"
        id="about-page-title"
        description="Product information for the Hivarium Operator Console."
      />

      <Card data-testid="about-card">
        <CardHeader>
          <CardTitle>Hivarium Operator Console</CardTitle>
          <CardDescription>
            An internal operations surface for the Hivarium agent platform. It
            lets operators review customer accounts, their subscriptions,
            feature entitlements and agent licenses, and browse the read-only
            agent catalog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <InfoRow label="Phase" value="Phase 1 — local data" />
            <InfoRow label="Data store" value="Browser localStorage" />
            <InfoRow label="Agent products" value={String(agentProductCount)} />
            <InfoRow label="Surfaces" value="Customers · Agents · About" />
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        All records shown in this build are seeded, fictional sample data and
        persist only to this browser&apos;s localStorage. Subscriptions,
        entitlements and licenses for newly created customers are managed
        separately in later phases.
      </p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
