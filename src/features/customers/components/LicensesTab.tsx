import { useState, useEffect } from "react";
import { useRepository } from "@/data/repository-context";
import { LicenseDocument } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

export function LicensesTab({ customerId }: { customerId: string }) {
    const repo = useRepository();
    const [licenses, setLicenses] = useState<LicenseDocument[] | null>(null);
    const [error, setError] = useState<string | null>(null);

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

    if (error) return <div className="text-red-500">{error}</div>;
    if (!licenses) return <Skeleton className="h-40 w-full" />;

    const handleAction = async (licId: string, action: string) => {
        const key = Date.now().toString();
        try {
            if (action === "suspend") {
                if (!confirm("Are you sure you want to suspend this license?")) return;
                await repo.suspendLicense(customerId, licId, { idempotencyKey: key, reason: "Operator action" });
            } else if (action === "revoke") {
                if (!confirm("Are you sure you want to revoke this license?")) return;
                await repo.revokeLicense(customerId, licId, { idempotencyKey: key, reason: "Operator action" });
            } else if (action === "download") {
                const doc = await repo.downloadLicense(customerId, licId);
                const blob = new Blob([doc], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `license-${licId}.txt`;
                a.click();
                return;
            }
            load();
        } catch (e) {
            alert("Action failed");
        }
    };

    const handleIssue = async () => {
        try {
            await repo.issueLicense(customerId, {
                productId: "prod_core",
                idempotencyKey: Date.now().toString(),
                entitlementLimits: { agents: 10 }
            });
            load();
        } catch (e) {
            alert("Failed to issue license");
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end">
                <Button onClick={handleIssue}>Issue New License</Button>
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
                                <Button size="sm" variant="outline" onClick={() => handleAction(lic.id, "suspend")}>Suspend</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleAction(lic.id, "revoke")}>Revoke</Button>
                            </>
                        )}
                        <Button size="sm" onClick={() => handleAction(lic.id, "download")}>Download Doc</Button>
                    </div>
                </div>
            ))}
        </div>
    );
}
