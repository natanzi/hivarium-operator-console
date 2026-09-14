import { useState, useEffect } from "react";
import { useRepository } from "@/data/repository-context";
import { CustomerRequest } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

export function RequestsTab({ customerId }: { customerId: string }) {
    const repo = useRepository();
    const [requests, setRequests] = useState<CustomerRequest[] | null>(null);
    const [error, setError] = useState<string | null>(null);

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

    if (error) return <div className="text-red-500">{error}</div>;
    if (!requests) return <Skeleton className="h-40 w-full" />;

    const handleDecision = async (reqId: string, status: string, isRenewal = false) => {
        if (isRenewal && status === "approved") {
            if (!confirm("Confirm license renewal?")) return;
            try {
                await repo.renewLicense(customerId, "placeholder-license-id", { idempotencyKey: Date.now().toString(), validUntil: new Date().toISOString() });
                await repo.recordDecision(customerId, reqId, { status, note: "License renewed successfully" });
                load();
                return;
            } catch (e) {
                alert("Failed to renew license. Request not marked completed.");
                return;
            }
        }

        if (!confirm("Are you sure?")) return;
        try {
            await repo.recordDecision(customerId, reqId, { status, note: "Updated" });
            load();
        } catch (e) {
            alert("Action failed: false success avoided.");
        }
    };

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
                            <Button size="sm" onClick={() => handleDecision(req.id, "approved", req.type === "license_renewal")}>Approve</Button>
                            <Button size="sm" variant="outline" onClick={() => handleDecision(req.id, "rejected")}>Reject</Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDecision(req.id, "needs_information")}>Needs Info</Button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
