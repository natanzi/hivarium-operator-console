import { useState, useEffect } from "react";
import { useRepository } from "@/data/repository-context";
import { LicenseDocument } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export function LicensesTab({ customerId }: { customerId: string }) {
    const repo = useRepository();
    const [licenses, setLicenses] = useState<LicenseDocument[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [actionDialog, setActionDialog] = useState<{ id: string | null; action: string; title: string; desc: string }>({ id: null, action: "", title: "", desc: "" });
    const [deployInputs, setDeployInputs] = useState({ instanceId: "", environment: "production", deploymentMode: "", label: "" });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const load = async () => {
        try {
            const resp = await repo.listLicenses(customerId);
            setLicenses(resp);
        } catch (e) {
            setError("Failed to load licenses");
        }
    };

    useEffect(() => {
        load();
    }, [customerId]);

    const handleActionClick = (id: string | null, action: string) => {
        setActionError(null);
        let title = "";
        let desc = "";

        if (action === "suspend") {
            title = "Suspend License";
            desc = `Are you sure you want to suspend license ${id}? This will block its usage.`;
        } else if (action === "revoke") {
            title = "Revoke License";
            desc = `Are you sure you want to revoke license ${id}? This is irreversible.`;
        } else if (action === "issue") {
            title = "Issue New License";
            desc = "Are you sure you want to issue a new license for this customer? Consequential values will be applied.";
        } else if (action === "resume") {
            title = "Resume License";
            desc = `Are you sure you want to resume license ${id}? This will restore its usage.`;
        } else if (action === "replace") {
            title = "Replace License";
            desc = `Are you sure you want to replace license ${id}? A new successor license will be issued.`;
        } else if (action === "mark-deployed") {
            title = "Mark Deployed";
            desc = `Record an instance deployment for license ${id}.`;
            const lic = licenses?.find(l => l.id === id);
            setDeployInputs({
                instanceId: "",
                environment: "production",
                deploymentMode: lic?.deploymentType || "self-hosted",
                label: ""
            });
        }

        setActionDialog({ id, action, title, desc });
    };

    const confirmAction = async () => {
        const { id, action } = actionDialog;
        const key = Date.now().toString();
        setIsSubmitting(true);
        setActionError(null);

        try {
            if (action === "suspend" && id) {
                await repo.suspendLicense(customerId, id, { idempotencyKey: key, reason: "Operator action" });
            } else if (action === "revoke" && id) {
                await repo.revokeLicense(customerId, id, { idempotencyKey: key, reason: "Operator action" });
            } else if (action === "resume" && id) {
                await repo.resumeLicense(customerId, id, { idempotencyKey: key, reason: "Operator action" });
            } else if (action === "replace" && id) {
                await repo.replaceLicense(customerId, id, { idempotencyKey: key });
            } else if (action === "issue") {
                await repo.issueLicense(customerId, {
                    productId: "prod_core",
                    idempotencyKey: key,
                    entitlementLimits: { agents: 10 }
                });
            } else if (action === "mark-deployed" && id) {
                await repo.markDeployed(customerId, id, {
                    idempotencyKey: key,
                    ...deployInputs
                });
            }

            toast.success(`License successfully ${action}ed.`);
            setActionDialog({ ...actionDialog, id: null });
            load();
        } catch (e: any) {
            setActionError(e.message || "Action failed");
            toast.error(e.message || "Action failed");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDownload = async (licId: string) => {
        try {
            const doc = await repo.downloadLicense(customerId, licId);
            const blob = new Blob([doc], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `license-${licId}.txt`;
            a.click();
        } catch (e: any) {
            toast.error("Failed to download license.");
        }
    };

    if (error) return <div className="text-red-500">{error}</div>;
    if (!licenses) return <Skeleton className="h-40 w-full" />;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end">
                <Button onClick={() => handleActionClick(null, "issue")}>Issue New License</Button>
            </div>
            {licenses.length === 0 ? (
                <div className="p-4 border rounded text-center">No licenses</div>
            ) : licenses.map(lic => (
                <div key={lic.id} className="border p-4 rounded bg-card flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                        <div className="font-mono text-sm">{lic.id}</div>
                        <Badge variant={lic.status === "active" ? "default" : "secondary"}>{lic.status}</Badge>
                    </div>

                    <div className="grid grid-cols-2 text-sm gap-2 mt-2">
                        <div>Product: {lic.productId}</div>
                        <div>Revision: {lic.revision}</div>
                        <div>Valid From: {formatDate(lic.validFrom)}</div>
                        <div>Valid Until: {lic.validUntil ? formatDate(lic.validUntil) : "Perpetual"}</div>
                    </div>

                    <div className="flex gap-2 mt-4">
                        {lic.status === "active" && (
                            <>
                                <Button size="sm" variant="outline" onClick={() => handleActionClick(lic.id, "suspend")}>Suspend</Button>
                                <Button size="sm" variant="outline" onClick={() => handleActionClick(lic.id, "replace")}>Replace</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleActionClick(lic.id, "revoke")}>Revoke</Button>
                                {["self-hosted", "air-gapped"].includes(lic.deploymentType) && (
                                    <Button size="sm" variant="outline" onClick={() => handleActionClick(lic.id, "mark-deployed")}>Mark Deployed</Button>
                                )}
                            </>
                        )}
                        {lic.status === "suspended" && (
                            <>
                                <Button size="sm" variant="outline" onClick={() => handleActionClick(lic.id, "resume")}>Resume</Button>
                            </>
                        )}
                        <Button size="sm" onClick={() => handleDownload(lic.id)}>Download Doc</Button>
                    </div>
                </div>
            ))}

            <AlertDialog open={actionDialog.id !== null || actionDialog.action === "issue"} onOpenChange={open => {
                if (!open && !isSubmitting) setActionDialog({ ...actionDialog, id: null, action: "" });
            }}>
                <AlertDialogContent data-testid={`license-${actionDialog.action}-dialog`}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{actionDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {actionDialog.desc}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {actionDialog.action === "mark-deployed" && (
                        <div className="flex flex-col gap-3 mt-4 text-sm">
                            <div>
                                <label className="block mb-1 font-medium">Instance ID</label>
                                <input className="w-full border p-2 rounded" value={deployInputs.instanceId} onChange={e => setDeployInputs({ ...deployInputs, instanceId: e.target.value })} placeholder="e.g. i-12345" />
                            </div>
                            <div>
                                <label className="block mb-1 font-medium">Environment</label>
                                <input className="w-full border p-2 rounded" value={deployInputs.environment} onChange={e => setDeployInputs({ ...deployInputs, environment: e.target.value })} />
                            </div>
                            <div>
                                <label className="block mb-1 font-medium">Deployment Mode</label>
                                <input className="w-full border p-2 rounded" value={deployInputs.deploymentMode} onChange={e => setDeployInputs({ ...deployInputs, deploymentMode: e.target.value })} />
                            </div>
                            <div>
                                <label className="block mb-1 font-medium">Label (optional)</label>
                                <input className="w-full border p-2 rounded" value={deployInputs.label} onChange={e => setDeployInputs({ ...deployInputs, label: e.target.value })} />
                            </div>
                        </div>
                    )}
                    {actionError && (
                        <div className="p-3 bg-red-100 text-red-900 text-sm rounded mt-2 border border-red-200">
                            {actionError}
                        </div>
                    )}
                    <AlertDialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setActionDialog({ ...actionDialog, id: null, action: "" })}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant={["revoke", "suspend"].includes(actionDialog.action) ? "destructive" : "default"}
                            onClick={confirmAction}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Processing..." : `Confirm ${actionDialog.action}`}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
