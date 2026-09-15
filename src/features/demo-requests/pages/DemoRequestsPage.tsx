import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DEMO_REQUEST_STATUSES } from "@/domain/demo-request";
import { formatDate } from "@/lib/format";
import { listDemoRequests, type DemoRequestListItem } from "../demo-api";
import { DEMO_STATUS_LABELS, DEPLOYMENT_LABELS, AGENT_COUNT_LABELS } from "../labels";

export function DemoRequestsPage() {
  const [items, setItems] = useState<DemoRequestListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems((await listDemoRequests({ status, q: search.trim() || undefined })).items);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load demo requests.");
    }
  }, [search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="overflow-x-hidden">
      <PageHeader
        title="Demo Requests"
        description="Review evaluation requests submitted from hivarium.dev. Approval provisions a time-limited research workspace, not a commercial contract."
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4" />
          <Input
            aria-label="Search demo requests"
            data-testid="demo-request-search"
            className="pl-9"
            placeholder="Organization, name, or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">Status</span>
          <select
            aria-label="Filter by status"
            data-testid="demo-request-status-filter"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            {DEMO_REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {DEMO_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loadError ? (
        <div role="alert" className="border-destructive/40 rounded-md border p-6">
          <p className="font-medium">Could not load demo requests</p>
          <p className="text-muted-foreground mt-1 text-sm">{loadError}</p>
          <Button className="mt-4" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : items === null ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading demo requests">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p data-testid="demo-requests-empty" className="text-muted-foreground py-12 text-sm">
          No demo requests match the current filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">Demo evaluation requests</caption>
            <thead>
              <tr className="border-b">
                <th className="py-2 font-medium">Organization</th>
                <th className="py-2 font-medium">Applicant</th>
                <th className="py-2 font-medium">Work email</th>
                <th className="py-2 font-medium">Use case</th>
                <th className="py-2 font-medium">Expected agents</th>
                <th className="py-2 font-medium">Deployment</th>
                <th className="py-2 font-medium">Submitted</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} data-testid={`demo-row-${item.id}`} className="border-b">
                  <td className="py-3">
                    <div className="font-medium">{item.organizationName}</div>
                    <div className="text-muted-foreground text-xs">{item.publicReference}</div>
                  </td>
                  <td className="py-3">{item.applicantName}</td>
                  <td className="py-3">{item.applicantEmail}</td>
                  <td className="max-w-[180px] truncate py-3" title={item.useCase}>
                    {item.useCase}
                  </td>
                  <td className="py-3">{AGENT_COUNT_LABELS[item.expectedAgentCount] ?? item.expectedAgentCount}</td>
                  <td className="py-3">{DEPLOYMENT_LABELS[item.deploymentPreference]}</td>
                  <td className="py-3">{formatDate(item.submittedAt)}</td>
                  <td className="py-3">{DEMO_STATUS_LABELS[item.status]}</td>
                  <td className="py-3">
                    <a className="font-medium underline-offset-4 hover:underline" href={`/demo-requests/${item.id}`}>
                      Review
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
