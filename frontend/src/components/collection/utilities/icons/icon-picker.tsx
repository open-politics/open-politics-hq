"use client";
import React, { useMemo, useState } from "react";
import * as LucideIcons from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Icon picker — backed by lucide-react (was @heroicons/react before Phase 9).
 *
 * Schemas in the wild still reference HeroIcon names like `UserIcon`,
 * `BriefcaseIcon`, etc. We resolve those via `HEROICON_ALIASES` so stored
 * graph-visual declarations keep rendering; new schemas write Lucide names
 * (no trailing "Icon" suffix).
 */

type IconEntry = {
  /** Canonical lucide-react component name (used for storage going forward). */
  name: string;
  /** Human-friendly label for the picker search. */
  friendly_name: string;
  Component: React.ComponentType<React.ComponentPropsWithoutRef<"svg"> & { size?: number | string }>;
};

/**
 * HeroIcon → Lucide name aliases for the most common legacy references.
 *
 * Lucide names are suffix-free (`User`, `Briefcase`); HeroIcons use the
 * `*Icon` suffix. Anything not in this table falls back to stripping the
 * trailing `Icon` segment before looking up in lucide-react.
 */
const HEROICON_ALIASES: Record<string, string> = {
  // People / identity
  UserIcon: "User",
  UserCircleIcon: "CircleUser",
  UsersIcon: "Users",
  UserGroupIcon: "Users",
  IdentificationIcon: "BadgeCheck",
  AtSymbolIcon: "AtSign",
  // Work / orgs
  BriefcaseIcon: "Briefcase",
  BuildingOfficeIcon: "Building2",
  BuildingOffice2Icon: "Building2",
  BuildingLibraryIcon: "Landmark",
  HomeIcon: "Home",
  // Action
  ArrowRightIcon: "ArrowRight",
  ArrowLeftIcon: "ArrowLeft",
  ArrowUpIcon: "ArrowUp",
  ArrowDownIcon: "ArrowDown",
  PlusIcon: "Plus",
  MinusIcon: "Minus",
  XMarkIcon: "X",
  TrashIcon: "Trash2",
  PencilIcon: "Pencil",
  MagnifyingGlassIcon: "Search",
  // Comms
  ChatBubbleLeftIcon: "MessageCircle",
  ChatBubbleBottomCenterTextIcon: "MessageSquareText",
  EnvelopeIcon: "Mail",
  PhoneIcon: "Phone",
  MegaphoneIcon: "Megaphone",
  // Data / shapes
  ChartBarIcon: "BarChart",
  ChartPieIcon: "PieChart",
  ChartLineIcon: "LineChart",
  TableCellsIcon: "Table",
  PresentationChartLineIcon: "LineChart",
  Squares2X2Icon: "LayoutGrid",
  // Status
  CheckIcon: "Check",
  CheckCircleIcon: "CircleCheck",
  ExclamationTriangleIcon: "TriangleAlert",
  InformationCircleIcon: "Info",
  QuestionMarkCircleIcon: "CircleHelp",
  // Navigation
  GlobeAltIcon: "Globe",
  MapPinIcon: "MapPin",
  FlagIcon: "Flag",
  LockClosedIcon: "Lock",
  LockOpenIcon: "LockOpen",
  // Documents
  DocumentIcon: "FileText",
  DocumentTextIcon: "FileText",
  DocumentDuplicateIcon: "Files",
  FolderIcon: "Folder",
  BookOpenIcon: "BookOpen",
  NewspaperIcon: "Newspaper",
  // Time
  ClockIcon: "Clock",
  CalendarIcon: "Calendar",
  CalendarDaysIcon: "CalendarDays",
  // Misc
  StarIcon: "Star",
  HeartIcon: "Heart",
  BoltIcon: "Zap",
  CogIcon: "Cog",
  Cog6ToothIcon: "Settings",
  LightBulbIcon: "Lightbulb",
  SparklesIcon: "Sparkles",
  FireIcon: "Flame",
};

/**
 * Resolve a stored icon name (HeroIcon or Lucide) to the current Lucide
 * component. Returns `null` when no mapping or fallback works.
 */
function resolveLucideComponent(
  iconName: string,
): React.ComponentType<any> | null {
  if (!iconName) return null;
  const direct = (LucideIcons as any)[iconName];
  if (typeof direct === "function" || typeof direct === "object") return direct;

  const alias = HEROICON_ALIASES[iconName];
  if (alias) {
    const aliased = (LucideIcons as any)[alias];
    if (aliased) return aliased;
  }
  // Fallback: strip trailing `Icon` (HeroIcon convention) and try again.
  if (iconName.endsWith("Icon")) {
    const stripped = iconName.slice(0, -4);
    const fromStrip = (LucideIcons as any)[stripped];
    if (fromStrip) return fromStrip;
  }
  return null;
}

export const useIconPicker = (): {
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  icons: IconEntry[];
} => {
  const icons: IconEntry[] = useMemo(
    () =>
      Object.entries(LucideIcons)
        // Lucide also exports helper types/utilities — filter to actual
        // React components (capital-letter names + function-shaped values).
        .filter(([name, Comp]) =>
          /^[A-Z][A-Za-z0-9]+$/.test(name) &&
          (typeof Comp === "function" || typeof Comp === "object") &&
          name !== "LucideIcon" && name !== "Icon" && name !== "createLucideIcon",
        )
        .map(([iconName, IconComponent]) => ({
          name: iconName,
          friendly_name:
            iconName.match(/[A-Z][a-z]+/g)?.join(" ") ?? iconName,
          Component: IconComponent as React.ComponentType<any>,
        })),
    [],
  );

  const [search, setSearch] = useState("");
  const filteredIcons = useMemo(() => {
    if (search === "") return icons;
    const needle = search.toLowerCase();
    return icons.filter((icon) => icon.name.toLowerCase().includes(needle));
  }, [icons, search]);

  return { search, setSearch, icons: filteredIcons };
};

export const IconRenderer = ({
  icon,
  ...rest
}: {
  icon: string;
} & React.ComponentPropsWithoutRef<"svg">) => {
  const { theme } = useTheme();
  const IconComponent = resolveLucideComponent(icon);

  if (!IconComponent) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Icon "${icon}" not found in lucide-react (nor in HeroIcon fallback map).`);
    }
    return null;
  }

  const iconColor = theme === "dark" ? "text-white" : "text-black";
  return <IconComponent data-slot="icon" className={iconColor} {...rest} />;
};
