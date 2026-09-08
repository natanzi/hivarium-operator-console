import { Boxes, Info, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface NavLink {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
}

export const NAV_LINKS: NavLink[] = [
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/agents", label: "Agent Catalog", icon: Boxes },
  { to: "/settings/about", label: "About", icon: Info },
];

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside
      data-slot="hivarium-sidebar"
      aria-label="Primary"
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r md:flex",
        className
      )}
    >
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div
          className="bg-primary text-primary-foreground size-8 rounded-lg shadow-sm"
          data-testid="brand-mark"
          aria-hidden="true"
        >
          <span className="flex h-full items-center justify-center font-semibold text-xs tracking-widest">
            HV
          </span>
        </div>
        <div className="leading-tight">
          <p data-testid="brand-name" className="text-sm font-semibold">
            Hivarium
          </p>
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Operator Console
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        <p className="text-muted-foreground px-2 text-[11px] font-medium tracking-wider uppercase">
          Workspace
        </p>
        {NAV_LINKS.map((link) => (
          <NavLinkItem key={link.to} link={link} />
        ))}
      </nav>

      <div className="border-border text-muted-foreground border-t px-5 py-4 text-xs">
        <p className="font-medium">Phase 1 · Local data</p>
        <p className="mt-1 leading-relaxed opacity-80">
          Records persist to this browser&apos;s localStorage. Reset anytime from
          the Customers screen.
        </p>
      </div>
    </aside>
  );
}

function NavLinkItem({ link }: { link: NavLink }) {
  const Icon = link.icon;
  return (
    <a
      href={link.to}
      data-nav-link={link.to}
      data-testid={`nav-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Icon className="size-4 shrink-0 opacity-70 transition-opacity group-hover:opacity-100" />
      <span>{link.label}</span>
      {link.to === "/agents" && (
        <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
          read-only
        </Badge>
      )}
    </a>
  );
}
