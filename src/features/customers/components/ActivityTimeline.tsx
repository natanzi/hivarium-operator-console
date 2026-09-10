import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import type { ActivityEvent, AgentProduct } from "@/domain/types";
import { formatDateTime } from "@/lib/format";

/**
 * Semantic chronological activity history for a customer.
 *
 * Events render newest first. Automatic revocations caused by an arrangement
 * termination are separate entries that stay visually linked to the
 * commercial event that triggered them via their `causationId`.
 */
export function ActivityTimeline({
  events,
  products,
}: {
  events: ActivityEvent[];
  products: Map<string, AgentProduct>;
}) {
  const eventsById = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events]
  );

  if (events.length === 0) {
    return (
      <div
        className="border-border flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-8 text-center"
        data-testid="activity-empty"
      >
        <h3 className="text-sm font-semibold">No activity recorded</h3>
        <p className="text-muted-foreground max-w-sm text-sm">
          No commercial or access changes have been recorded yet.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-3" data-testid="activity-timeline">
      {events.map((event) => {
        const cause = event.causationId
          ? eventsById.get(event.causationId)
          : undefined;
        return (
          <li
            key={event.id}
            className="border-border rounded-lg border bg-card px-4 py-3"
            data-testid={`activity-${event.id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatDateTime(event.occurredAt)}
              </span>
              <Badge variant="outline" className="text-xs">
                {event.type}
              </Badge>
              <span className="text-muted-foreground text-xs capitalize">
                {event.source}
              </span>
            </div>
            <p className="mt-1 text-sm">{event.label}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Result: <span className="capitalize">{event.resultingState}</span>
              {event.subjectId2 ? (
                <>
                  {" "}
                  · {products.get(event.subjectId2)?.name ?? event.subjectId2}
                </>
              ) : null}
            </p>
            {cause ? (
              <p
                className="text-muted-foreground mt-1 text-xs"
                data-testid={`activity-cause-${event.id}`}
              >
                Automatic · caused by {cause.label}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}