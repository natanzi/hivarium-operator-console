import { useEffect, useState } from "react";
import { Boxes, Info, LogOut, ShieldAlert, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useRepository } from "@/data/repository-context";
import { ApiError } from "@/data/api-repository";
import type { OperatorIdentity } from "@/data/local-storage-repository";

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

type OperatorState =
  | { status: "loading" }
  | { status: "signed-in"; operator: OperatorIdentity }
  | { status: "sign-in-required" }
  | { status: "error" };

/**
 * App navigation sidebar. Rendered inside a `SidebarProvider` (see Layout) so
 * it can collapse into an off-canvas drawer on desktop and a sheet on mobile.
 *
 * On mount it resolves the current operator via `repository.getCurrentOperator()`
 * (which calls `GET /api/me` on the API-backed repository) so the footer can
 * show "Signed in as {email}". A 401 renders a sign-in-required state instead.
 */
export function AppSidebar({ className }: SidebarProps) {
  const repository = useRepository();
  const [operator, setOperator] = useState<OperatorState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    repository
      .getCurrentOperator()
      .then((identity) => {
        if (!cancelled) setOperator({ status: "signed-in", operator: identity });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setOperator({ status: "sign-in-required" });
        } else {
          setOperator({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  return (
    <Sidebar className={className}>
      <SidebarHeader>
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
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_LINKS.map((link) => (
                <NavLinkItem key={link.to} link={link} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="border-border border-t p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className="h-10 border border-sidebar-border bg-sidebar-accent/40 font-medium shadow-sm hover:bg-sidebar-accent"
              >
                <a
                  href="/cdn-cgi/access/logout"
                  aria-label="Sign out of Hivarium Operator Console"
                  data-testid="sign-out"
                >
                  <LogOut className="size-4 shrink-0 opacity-70" />
                  <span>Sign out</span>
                  <span className="text-muted-foreground ml-auto text-[10px] tracking-wide uppercase">
                    Secure
                  </span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="text-muted-foreground mt-3 border-t border-sidebar-border px-2 pt-3 text-xs">
            <OperatorFooter state={operator} />
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function OperatorFooter({ state }: { state: OperatorState }) {
  if (state.status === "loading") {
    return (
      <p className="leading-relaxed opacity-80" data-testid="operator-loading">
        Checking session…
      </p>
    );
  }

  if (state.status === "sign-in-required") {
    return (
      <div
        className="flex items-start gap-2 leading-relaxed"
        data-testid="sign-in-required"
      >
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 opacity-70" />
        <p>
          <span className="font-medium">Sign-in required.</span>{" "}
          <span className="opacity-80">
            Re-authenticate through Cloudflare Access to continue.
          </span>
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p className="leading-relaxed opacity-80" data-testid="operator-error">
        Could not verify your session.
      </p>
    );
  }

  return (
    <div className="leading-relaxed" data-testid="signed-in-as">
      <p className="font-medium">Signed in as</p>
      <p className="mt-0.5 truncate opacity-80" data-testid="operator-email">
        {state.operator.email}
      </p>
    </div>
  );
}

function NavLinkItem({ link }: { link: NavLink }) {
  const Icon = link.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <a
          href={link.to}
          data-nav-link={link.to}
          data-testid={`nav-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <Icon className="size-4 shrink-0 opacity-70" />
          <span>{link.label}</span>
          {link.to === "/agents" && (
            <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
              read-only
            </Badge>
          )}
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
