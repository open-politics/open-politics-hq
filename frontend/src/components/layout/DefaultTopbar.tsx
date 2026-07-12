"use client";

/**
 * DefaultTopbar — the fallback chrome shown in the app top bar when no view
 * claims the slot (home and generic routes). It's the breadcrumb + invitations
 * bell + dismissible docs banner that used to live inline in ``app/hq/layout.tsx``,
 * extracted here and made self-contained so the layout only wires the slot.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, X } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { InvitationInbox } from "@/components/collaboration/InvitationInbox";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useUserPreferencesStore } from "@/zustand_stores/storeUserPreferences";

// Generate breadcrumbs from the current path and the active infospace.
function useBreadcrumbs(activeInfospace: { id: number; name?: string | null } | null) {
  const pathname = usePathname();
  const segments = pathname
    .replace(/^\/|\/$/g, '')
    .split('/')
    .filter(Boolean);

  const items: { label: string; href: string }[] = [];
  let href = '';
  segments.forEach((seg, idx) => {
    href += '/' + seg;
    if (seg === 'hq') {
      items.push({ label: 'HQ', href: '/hq' });
    } else if (seg === 'infospaces' && activeInfospace) {
      items.push({ label: 'Infospaces', href: '/hq/infospaces' });
      if (segments[idx + 1] && segments[idx + 1] === String(activeInfospace.id)) {
        items.push({ label: activeInfospace.name || 'Infospace', href: `/hq/infospaces/${activeInfospace.id}` });
      }
    } else if (
      seg !== 'hq' &&
      seg !== 'infospaces' &&
      (!activeInfospace || seg !== String(activeInfospace.id))
    ) {
      items.push({ label: seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), href });
    }
  });

  if (items.length === 0 && segments[0] === 'hq') {
    items.push({ label: 'HQ', href: '/hq' });
  }

  return items;
}

export function DefaultTopbar() {
  const activeInfospace = useInfospaceStore((s) => s.activeInfospace);
  const breadcrumbs = useBreadcrumbs(activeInfospace);
  const { preferences, updatePreference } = useUserPreferencesStore();

  return (
    <>
      <div className="flex-1 min-w-0">
        <Breadcrumb>
          <BreadcrumbList className="flex-wrap">
            {breadcrumbs.map((item, idx) => (
              <span key={item.href} className="flex items-center">
                <BreadcrumbItem>
                  <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                </BreadcrumbItem>
                {idx < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <InvitationInbox />

      {/* Docs banner — desktop */}
      {!preferences.docs_banner_dismissed && (
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-500 rounded-md flex-shrink-0">
          <Link
            href="https://docs.open-politics.org/pages/app/overview"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 transition-colors font-medium"
          >
            <span className="text-sm">📚 Check out our updated docs</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
          <span className="text-blue-400">•</span>
          <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full font-semibold">
            v0.9.9
          </span>
          <button
            onClick={() => updatePreference('docs_banner_dismissed', true)}
            className="ml-1 p-0.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 transition-colors"
            aria-label="Dismiss banner"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </>
  );
}
