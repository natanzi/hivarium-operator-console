import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { DEPLOYMENT_PREFERENCES } from "@/domain/demo-request";
import {
  getDemoRequest,
  saveDemoConfiguration,
  transitionDemoRequest,
  type DemoProposedConfigDto,
  type DemoRequestDetail,
} from "../demo-api";
import { DemoActionDialog } from "../components/DemoActionDialog";
import { DEMO_STATUS_LABELS, DEPLOYMENT_LABELS } from "../labels";

export function DemoRequestDetailPage() {
  const { requestId = "" } = useParams();
  const [detail, setDetail] = useState<DemoRequestDetail | null>(null);
  const [proposed, setProposed] = useState<DemoProposedConfigDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await getDemoRequest(requestId);
      setDetail(next);
      setProposed(next.proposed);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load this demo request.");
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!detail || !proposed) return;
    setSaving(true);
    try {
      const next = await saveDemoConfiguration(detail.id, detail.version, proposed);
      setDetail(next);
      setProposed(next.proposed);
      toast.success("Proposed configuration saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save configuration.");
    } finally {
      setSaving(false);
    }
  }

  async function act(
    action: "start_review" | "needs_information" | "reject" | "approve" | "retry",
    note: string,
  ) {
    if (!detail) return;
    try {
      const next = await transitionDemoRequest(detail.id, action, detail.version, note);
      setDetail(next);
      setProposed(next.proposed);
      toast.success("Demo request updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The action could not be completed.");
      throw error;
    }
  }

  if (loadError) {
    return (
      <div role="alert">
        <PageHeader title="Demo request" />
        <p>{loadError}</p>
        <Button className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!detail || !proposed) {
    return (
      <div aria-busy="true" aria-label="Loading demo request">
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const canEdit = ["submitted", "under_review", "needs_information", "provisioning_failed"].includes(
    detail.status,
  );

  return (
    <div className="space-y-10">
      <PageHeader
        title={detail.original.organizationName}
        description={`Evaluation request ${detail.publicReference}. This workflow provisions a research/evaluation workspace, not a commercial sale.`}
      >
        <span data-testid="demo-status">{DEMO_STATUS_LABELS[detail.status]}</span>
      </PageHeader>

      <section aria-labelledby="original-heading" className="space-y-3">
        <h2 id="original-heading" className="text-lg font-semibold">
          Original request
        </h2>
        <p className="text-muted-foreground text-sm">Submitted payload is read-only.</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Applicant" value={`${detail.original.applicantName} · ${detail.original.applicantEmail}`} />
          <Field label="Organization domain" value={detail.original.organizationDomain} />
          <Field label="Role / title" value={detail.original.roleTitle || "—"} />
          <Field
            label="Deployment preference"
            value={DEPLOYMENT_LABELS[detail.original.deploymentPreference]}
          />
          <Field label="Expected agent count" value={detail.original.expectedAgentCount || "—"} />
          <Field label="Timeline" value={detail.original.timeline || "—"} />
          <div className="sm:col-span-2">
            <Field label="Use case" value={detail.original.useCase} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Infrastructure notes" value={detail.original.infrastructureNotes || "—"} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Additional details" value={detail.original.additionalDetails || "—"} />
          </div>
        </dl>
      </section>

      <section aria-labelledby="proposed-heading" className="space-y-4">
        <h2 id="proposed-heading" className="text-lg font-semibold">
          Proposed demo configuration
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="customerName"
            label="Customer display name"
            value={proposed.customerName}
            disabled={!canEdit}
            onChange={(value) => setProposed({ ...proposed, customerName: value })}
          />
          <TextField
            id="customerDomain"
            label="Customer domain"
            value={proposed.customerDomain}
            disabled={!canEdit}
            onChange={(value) => setProposed({ ...proposed, customerDomain: value })}
          />
          <TextField
            id="demoStartAt"
            label="Demo start"
            value={proposed.demoStartAt}
            disabled={!canEdit}
            onChange={(value) => setProposed({ ...proposed, demoStartAt: value })}
          />
          <TextField
            id="demoExpiresAt"
            label="Demo expiration"
            value={proposed.demoExpiresAt}
            disabled={!canEdit}
            onChange={(value) => setProposed({ ...proposed, demoExpiresAt: value })}
          />
          <label className="grid gap-1 text-sm">
            <span>Deployment model</span>
            <select
              className="border-input bg-background h-9 rounded-md border px-3"
              disabled={!canEdit}
              value={proposed.deploymentModel}
              onChange={(event) =>
                setProposed({
                  ...proposed,
                  deploymentModel: event.target.value as DemoProposedConfigDto["deploymentModel"],
                })
              }
            >
              {DEPLOYMENT_PREFERENCES.map((value) => (
                <option key={value} value={value}>
                  {DEPLOYMENT_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <TextField
            id="enabledFeatures"
            label="Enabled features (comma-separated)"
            value={proposed.enabledFeatures.join(", ")}
            disabled={!canEdit}
            onChange={(value) =>
              setProposed({
                ...proposed,
                enabledFeatures: value.split(",").map((item) => item.trim()).filter(Boolean),
              })
            }
          />
          <TextField
            id="permittedAgentIds"
            label="Permitted agents (comma-separated ids)"
            value={proposed.permittedAgentIds.join(", ")}
            disabled={!canEdit}
            onChange={(value) =>
              setProposed({
                ...proposed,
                permittedAgentIds: value.split(",").map((item) => item.trim()).filter(Boolean),
              })
            }
          />
          <div className="sm:col-span-2">
            <Label htmlFor="capacityNotes">Limits / capacity</Label>
            <Textarea
              id="capacityNotes"
              disabled={!canEdit}
              value={proposed.capacityNotes}
              onChange={(event) => setProposed({ ...proposed, capacityNotes: event.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="customerVisibleNotes">Notes visible to customer</Label>
            <Textarea
              id="customerVisibleNotes"
              disabled={!canEdit}
              value={proposed.customerVisibleNotes}
              onChange={(event) =>
                setProposed({ ...proposed, customerVisibleNotes: event.target.value })
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="operatorNotes">Internal operator notes</Label>
            <Textarea
              id="operatorNotes"
              disabled={!canEdit}
              value={proposed.operatorNotes}
              onChange={(event) => setProposed({ ...proposed, operatorNotes: event.target.value })}
            />
          </div>
        </div>
        {canEdit ? (
          <Button type="button" onClick={() => void save()} disabled={saving} data-testid="save-demo-config">
            {saving ? "Saving…" : "Save proposed configuration"}
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="provisioning-heading" className="space-y-2">
        <h2 id="provisioning-heading" className="text-lg font-semibold">
          Provisioning status
        </h2>
        <p>Job status: {detail.provisioning.status}</p>
        <p>Customer id: {detail.provisioning.customerId || "Not provisioned"}</p>
        <p>Approved by: {detail.provisioning.approvedBy || "—"}</p>
      </section>

      <section aria-labelledby="actions-heading" className="flex flex-wrap gap-2">
        <h2 id="actions-heading" className="sr-only">
          Actions
        </h2>
        {detail.status === "submitted" ? (
          <DemoActionDialog
            action="start_review"
            title="Start review?"
            description="Moves this evaluation request into operator review. The original submission stays unchanged."
            confirmLabel="Start review"
            testId="start-review-dialog"
            onConfirm={(note) => act("start_review", note)}
            trigger={<Button data-testid="start-review">Start review</Button>}
          />
        ) : null}
        {detail.status === "under_review" || detail.status === "needs_information" ? (
          <DemoActionDialog
            action="needs_information"
            title="Request more information?"
            description="The applicant receives an evaluation follow-up email. This is not a commercial notice."
            confirmLabel="Request information"
            requireNote
            testId="needs-info-dialog"
            onConfirm={(note) => act("needs_information", note)}
            trigger={<Button variant="outline">Request more information</Button>}
          />
        ) : null}
        {["submitted", "under_review", "needs_information"].includes(detail.status) ? (
          <DemoActionDialog
            action="reject"
            title="Reject this evaluation request?"
            description="The request is retained. No customer workspace is created."
            confirmLabel="Reject request"
            requireNote
            testId="reject-dialog"
            onConfirm={(note) => act("reject", note)}
            trigger={
              <Button variant="outline" data-testid="reject-request">
                Reject request
              </Button>
            }
          />
        ) : null}
        {detail.status === "under_review" ? (
          <DemoActionDialog
            action="approve"
            title="Approve and provision demo?"
            description="Creates or reuses the evaluation customer, grants selected access, and provisions Customer Portal membership. A welcome email is sent only after mandatory steps succeed."
            confirmLabel="Approve and provision demo"
            testId="approve-dialog"
            onConfirm={(note) => act("approve", note)}
            trigger={<Button data-testid="approve-demo">Approve and provision demo</Button>}
          />
        ) : null}
        {detail.status === "provisioning_failed" ? (
          <DemoActionDialog
            action="retry"
            title="Retry failed provisioning?"
            description="Retries remaining steps without duplicating the evaluation customer or membership."
            confirmLabel="Retry provisioning"
            testId="retry-dialog"
            onConfirm={(note) => act("retry", note)}
            trigger={<Button data-testid="retry-provisioning">Retry failed provisioning</Button>}
          />
        ) : null}
      </section>

      <section aria-labelledby="audit-heading" className="space-y-3">
        <h2 id="audit-heading" className="text-lg font-semibold">
          Audit history
        </h2>
        {detail.events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No events recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {detail.events.map((event, index) => (
              <li key={`${event.occurredAt}-${index}`} className="border-l pl-3">
                <p className="font-medium">{event.action}</p>
                <p className="text-muted-foreground text-xs">
                  {event.occurredAt} · {event.principal}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
