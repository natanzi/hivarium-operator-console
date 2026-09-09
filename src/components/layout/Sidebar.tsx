import { Boxes, Info, LogOut, Users } from "lucide-react";

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

/**
 * App navigation sidebar. Rendered inside a `SidebarProvider` (see Layout) so
 * it can collapse into an off-canvas drawer on desktop and a sheet on mobile.
 */
export function AppSidebar({ className }: SidebarProps) {
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
            <p className="font-medium">Phase 1 · Local data</p>
            <p className="mt-1 leading-relaxed opacity-80">
              Records persist to this browser&apos;s localStorage. Reset anytime
              from the Customers screen.
            </p>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
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
