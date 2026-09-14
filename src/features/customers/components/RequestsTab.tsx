import { useState, useEffect } from "react";
import { useRepository } from "@/data/repository-context";
import { CustomerRequest } from "@/domain/types";
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

export function RequestsTab({ customerId }: { customerId: string }) {
    const repo = useRepository();
    const [requests, setRequests] = useState<CustomerRequest[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Dialog state
    const [actionReq, setActionReq] = useState<{ id: string; type: string; status: string; customerId: string } | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const load = async () => {
        try {
            const resp = await repo.listRequests(customerId);
            setRequests(resp);
        } catch (e) {
            setError("Failed to load requests");
        }
    };

    useEffect(() => {
        load();
    }, [customerId]);

    const handleActionClick = (req: CustomerRequest, status: string) => {
        setActionError(null);
        setActionReq({ id: req.id, type: req.type, status, customerId });
        setActionOpen(true);
    };

    const confirmAction = async () => {
        if (!actionReq) return;
        setIsSubmitting(true);
        setActionError(null);

        try {
            const isRenewal = actionReq.type === "license_renewal" && actionReq.status === "approved";
            let externalReference = undefined;

            if (isRenewal) {
                try {
                    // Step 1: Call License Service
                    const lic = await repo.renewLicense(customerId, "placeholder-license-id", {
                        idempotencyKey: Date.now().toString(),
                        validUntil: new Date().toISOString()
                    });
                    externalReference = lic.id;
                } catch (e) {
                    throw new Error("Failed to renew license. Request not marked completed.");
                }
            }

            // Step 2: Portal Request Update
            try {
                await repo.recordDecision(customerId, actionReq.id, {
                    status: actionReq.status,
                    note: externalReference ? `License ${externalReference} renewed` : "Updated"
                });
            } catch (e) {
                if (isRenewal && externalReference) {
                    throw new Error(`Partial failure! License ${externalReference} was renewed, but portal request update failed. Please retry.`);
                }
                throw new Error("Failed to record decision in portal.");
            }

            toast.success(`Request ${actionReq.status} successfully.`);
            setActionOpen(false);
            load();
        } catch (e: any) {
            setActionError(e.message || "Action failed.");
            toast.error(e.message || "Action failed.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (error) return <div className="text-red-500">{error}</div>;
    if (!requests) return <Skeleton className="h-40 w-full" />;

    return (
        <div className="flex flex-col gap-4">
            {requests.length === 0 ? (
                <div className="p-4 border rounded text-center">No requests</div>
            ) : requests.map(req => (
                <div key={req.id} className="border p-4 rounded bg-card flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                        <div className="font-semibold text-lg">{req.type}</div>
                        <Badge>{req.status}</Badge>
                    </div>
                    <div className="text-sm">{req.summary}</div>
                    <div className="text-xs text-slate-500">Submitted: {formatDate(req.submittedAt)}</div>

                    {req.status === "pending" && (
                        <div className="flex gap-2 mt-2">
                            <Button size="sm" onClick={() => handleActionClick(req, "approved")}>Approve</Button>
                            <Button size="sm" variant="outline" onClick={() => handleActionClick(req, "rejected")}>Reject</Button>
                            <Button size="sm" variant="ghost" onClick={() => handleActionClick(req, "needs_information")}>Needs Info</Button>
                        </div>
                    )}
                </div>
            ))}

            <AlertDialog open={actionOpen} onOpenChange={open => !isSubmitting && setActionOpen(open)}>
                <AlertDialogContent data-testid="request-approval-dialog">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Decision</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to mark this {actionReq?.type} request as <strong>{actionReq?.status}</strong>?
                            {actionReq?.type === "license_renewal" && actionReq?.status === "approved" && (
                                <span className="block mt-2">This will immediately issue a license renewal mutation to the License Service.</span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {actionError && (
                        <div className="p-3 bg-red-100 text-red-900 text-sm rounded mt-2 border border-red-200">
                            {actionError}
                        </div>
                    )}
                    <AlertDialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setActionOpen(false)}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant={actionReq?.status === "rejected" ? "destructive" : "default"}
                            onClick={confirmAction}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Processing..." : `Confirm ${actionReq?.status}`}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
