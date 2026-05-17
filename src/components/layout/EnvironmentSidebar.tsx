import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AreaChart, ChevronLeft, ChevronRight, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { canAccessWithViewer } from "@/config/roleAccess";
import { useMenuVisibility } from "@/contexts/MenuVisibilityContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface SidebarNavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  /** Marks item as a placeholder — renders disabled with "Em breve" badge */
  comingSoon?: boolean;
  /** Sub-items rendered as a collapsible group under this item */
  children?: SidebarNavItem[];
  /** When true, suppresses the parent self-link in expanded collapsible and collapsed tooltip */
  noSelfLink?: boolean;
}

export interface SidebarNavSection {
  /** Section header label. Omit for the first unlabelled group. */
  label?: string;
  items: SidebarNavItem[];
}

interface EnvironmentSidebarProps {
  /** Pass either flat items (legacy) or sections (new) */
  sections?: SidebarNavSection[];
  items?: SidebarNavItem[];
  footerItem?: SidebarNavItem;
}

export function EnvironmentSidebar({ sections, items, footerItem }: EnvironmentSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { orgRole: role, viewerPermissions } = useOrganization();
  const { isMenuItemVisible } = useMenuVisibility();

  // Normalise: convert flat items to a single unnamed section for backwards compat
  const resolvedSections: SidebarNavSection[] = sections ?? (items ? [{ items }] : []);

  const renderLink = (item: SidebarNavItem) => {
    const isActive = location.pathname === item.path;
    const Icon = item.icon;

    if (item.comingSoon) {
      const inner = (
        <span
          key={item.path}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 opacity-50 cursor-not-allowed select-none overflow-hidden",
            collapsed && "justify-center w-12 px-0",
            "text-sidebar-foreground/50"
          )}
        >
          <Icon className="h-5 w-5 flex-shrink-0" />
          <span
            className={cn(
              "flex flex-1 items-center justify-between text-sm font-medium whitespace-nowrap transition-all duration-300 ease-in-out",
              collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
            )}
          >
            {item.label}
            <span className="ml-1.5 rounded-full bg-sidebar-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
              breve
            </span>
          </span>
        </span>
      );

      if (collapsed) {
        return (
          <Tooltip key={item.path} delayDuration={0}>
            <TooltipTrigger asChild>{inner}</TooltipTrigger>
            <TooltipContent side="right" className="font-medium">
              {item.label} — Em breve
            </TooltipContent>
          </Tooltip>
        );
      }
      return inner;
    }

    const linkContent = (
      <Link
        key={item.path}
        to={item.path}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 overflow-hidden",
          collapsed && "justify-center w-12 px-0",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-glow"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="h-5 w-5 flex-shrink-0" />
        <span
          className={cn(
            "text-sm font-medium whitespace-nowrap transition-all duration-300 ease-in-out",
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}
        >
          {item.label}
        </span>
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.path} delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  const renderSubLink = (item: SidebarNavItem) => {
    const isActive = location.pathname === item.path;
    const Icon = item.icon;

    const inner = (
      <Link
        key={item.path}
        to={item.path}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all duration-200 overflow-hidden",
          collapsed && "justify-center w-9 px-0",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-glow"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span
          className={cn(
            "font-medium whitespace-nowrap transition-all duration-300 ease-in-out",
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}
        >
          {item.label}
        </span>
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.path} delayDuration={0}>
          <TooltipTrigger asChild>{inner}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return inner;
  };

  const renderItem = (item: SidebarNavItem) => {
    if (!item.children || item.children.length === 0) {
      return renderLink(item);
    }

    // Item with children — collapsible group
    const Icon = item.icon;
    const isParentActive =
      location.pathname === item.path ||
      item.children.some((c) => location.pathname === c.path);

    if (collapsed) {
      // Collapsed: parent icon links to parent path; tooltip shows children list
      return (
        <Tooltip key={item.path} delayDuration={0}>
          <TooltipTrigger asChild>
            <Link
              to={item.path}
              className={cn(
                "flex items-center justify-center w-12 py-2.5 rounded-xl transition-all duration-200",
                isParentActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-glow"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="p-0 overflow-hidden">
            <div className="flex flex-col py-1 min-w-[160px]">
              {!item.noSelfLink && (<>
              <Link
                to={item.path}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors",
                  location.pathname === item.path
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
              <div className="h-px bg-border mx-2 my-1" />
              </>)}
              {item.children.map((child) => (
                <Link
                  key={child.path}
                  to={child.path}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                    location.pathname === child.path
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                      : "hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
                  )}
                >
                  <child.icon className="w-4 h-4" />
                  {child.label}
                </Link>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Collapsible key={item.path} defaultOpen={isParentActive}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 w-full text-left",
            isParentActive
              ? "text-sidebar-foreground font-medium"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Icon className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm font-medium flex-1 whitespace-nowrap">{item.label}</span>
          <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-3 pl-3 border-l border-sidebar-border space-y-0.5 mt-0.5 mb-1">
            {/* Parent page link as first sub-item (suppressed when noSelfLink is set) */}
            {!item.noSelfLink && renderSubLink({ ...item, children: undefined })}
            {item.children.map(renderSubLink)}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <aside
      className={cn(
        "group relative flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out",
        collapsed ? "w-20" : "w-56"
      )}
    >
      {/* Logo / brand */}
      <div className={cn("flex items-center gap-3 overflow-hidden py-6", collapsed ? "justify-center px-3" : "px-6")}>
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-primary shadow-glow transition-transform duration-300">
          <AreaChart className="h-5 w-5 text-primary-foreground" />
        </div>
        <div
          className={cn(
            "overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out",
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}
        >
          <h1 className="text-lg font-semibold tracking-tight">Analytics Pro</h1>
          <p className="text-xs text-sidebar-foreground/60">Marketplace</p>
        </div>
      </div>

      {/* Nav sections */}
      <nav className={cn("flex flex-1 flex-col overflow-y-auto pb-4", collapsed ? "items-center px-2 gap-1.5" : "px-3")}>
        {resolvedSections.map((section, sIdx) => {
          const visibleItems = section.items
            .map((item) => {
              if (!item.children) return item;
              // Filter children by menu visibility config AND viewer permissions
              const visibleChildren = item.children.filter(
                (child) =>
                  isMenuItemVisible(child.path, role) &&
                  canAccessWithViewer(role, child.path, viewerPermissions)
              );
              return { ...item, children: visibleChildren };
            })
            .filter((item) => {
              if (item.comingSoon) return true;
              if (!canAccessWithViewer(role, item.path, viewerPermissions)) return false;
              // Hide parent if all children are hidden
              if (item.children && item.children.length === 0) return false;
              return true;
            });
          if (visibleItems.length === 0) return null;

          return (
            <div key={sIdx} className={cn("flex flex-col", sIdx === 0 ? "pt-2" : "pt-3")}>
              {/* Section label */}
              {section.label && (
                <div
                  className={cn(
                    "mb-1 overflow-hidden transition-all duration-300 ease-in-out",
                    collapsed ? "h-px w-8 bg-sidebar-border/60 mx-auto my-2 rounded-full" : "px-3 pb-1"
                  )}
                >
                  {!collapsed && (
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/35 select-none">
                      {section.label}
                    </span>
                  )}
                </div>
              )}

              {/* Items */}
              <div className={cn("flex flex-col gap-0.5", collapsed && "items-center gap-1.5")}>
                {visibleItems.map(renderItem)}
              </div>
            </div>
          );
        })}

        {/* Footer item */}
        {footerItem && canAccessWithViewer(role, footerItem.path, viewerPermissions) && (
          <div className={cn("mt-auto pt-4 border-t border-sidebar-border/40", collapsed ? "w-full flex justify-center" : "")}>
            {renderLink(footerItem)}
          </div>
        )}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "absolute top-1/2 -right-3.5 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-sidebar-foreground/70 shadow-sm transition-all duration-200 hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
          collapsed ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>
    </aside>
  );
}
