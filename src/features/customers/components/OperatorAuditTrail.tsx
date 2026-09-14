import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import type { AuditEntry } from "@/domain/types";
import { formatDateTime } from "@/lib/format";

export function OperatorAuditTrail({
    entries,
    customerName,
}: {
    entries: AuditEntry[];
    customerName: string;
}) {
    const sorted = useMemo(() => {
        return [...entries].sort(
            (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
        );
    }, [entries]);

    if (sorted.length === 0) {
        return (
            <section className="mt-8">
                <header className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Operator audit trail</h2>
                    <span className="text-muted-foreground text-sm">0 entries</span>
                </header>
                <div
                    className="border-border flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-8 text-center"
                    data-testid="audit-empty"
                >
                    <h3 className="text-sm font-semibold">No operator audit entries yet</h3>
                    <p className="text-muted-foreground max-w-sm text-sm">
                        Operator actions on this customer will appear here.
                    </p>
                </div>
            </section>
        );
    }

    return (
        <section className="mt-8">
            <header className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Operator audit trail</h2>
                <span className="text-muted-foreground text-sm">
                    {sorted.length} {sorted.length === 1 ? "entry" : "entries"}
                </span>
            </header>
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                    <caption className="sr-only">
                        Operator audit trail for {customerName}
                    </caption>
                    <thead>
                        <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                            <th className="px-4 py-3 font-medium">When</th>
                            <th className="px-4 py-3 font-medium">Operator</th>
                            <th className="px-4 py-3 font-medium">Action</th>
                            <th className="px-4 py-3 font-medium">Subject</th>
                            <th className="px-4 py-3 font-medium">Summary</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {sorted.map((entry) => (
                            <tr key={entry.id} className="hover:bg-muted/30">
                                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                                    {formatDateTime(entry.occurredAt)}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                                    {entry.operatorEmail}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <span className="capitalize">{entry.action.replace(/_/g, " ")}</span>
                                        <Badge variant="outline" className="text-[10px] capitalize">
                                            {entry.subjectType}
                                        </Badge>
                                    </div>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                    {entry.subjectId}
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                    {entry.summary}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
