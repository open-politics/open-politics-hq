/**
 * icons — the icon half of the shared entity style system.
 *
 * `colors.ts` has, for years, answered one question well: *what colour is a
 * node of this type?* One function, one precedence chain, every surface
 * calling it. Icons had no such answer. They had a hand-written table of
 * **thirteen** glyphs in `graph/entityTypeIcons.ts`, keyed by kebab-case names
 * (`user`, `map-pin`), while the schema editor's picker enumerates all ~1600
 * exports of `lucide-react` and stores component names (`ActivityIcon`). The
 * two vocabularies never met. Every icon a user could actually pick resolved
 * to `undefined` and drew nothing — silently, because a missing glyph looks
 * exactly like a node that was never given one.
 *
 * So this is the icon's `colors.ts`: one resolver with the same precedence
 * chain, and one geometry source that 2D canvas, 3D texture and React all draw
 * from. `lucide` (the data-only twin of `lucide-react`, already a dependency)
 * publishes every icon as an `IconNode` — a list of `[tag, attrs]` pairs — so
 * the registry is the icon set itself rather than a copy of thirteen of them
 * that has to be extended by hand every time someone picks a fourteenth.
 *
 * ## Two tiers, on purpose
 *
 * The defaults are **statically** imported by name. `lucide` is
 * `sideEffects: false` ESM, so the bundler keeps exactly the fifteen glyphs
 * named below and drops the rest — a graph that styles nothing costs nothing
 * and paints on the first frame.
 *
 * Anything an author picked is **lazily** loaded: `loadIconNode` pulls the
 * barrel as one async chunk the first time a contract asks for a glyph outside
 * the default set. A graph view already carries three.js; one deferred icon
 * table is not what makes it heavy, and the alternative — bundling 1600 icons
 * into the initial graph chunk against the chance that one is used — is.
 */

// ─── Names ──────────────────────────────────────────────────────────────────
//
// The same icon reaches us under four spellings, because the picker has
// changed libraries twice and stored whatever the library of the day called
// it: `ActivityIcon` (lucide-react's suffixed alias — what the picker writes
// today), `Activity` (lucide's own PascalCase), `activity` (kebab, what the
// old graph table used) and `UserIcon` (HeroIcons, pre-Phase-9 schemas).
// Kebab is canonical here because it is what `lucide`'s module names use.

/** HeroIcon → Lucide renames that stripping `Icon` cannot recover.
 *
 *  Lives here rather than in the picker component because the picker is not
 *  the only reader any more — the canvas resolves stored names too, and a
 *  second copy of this table is a second thing to forget to update. */
export const HEROICON_ALIASES: Record<string, string> = {
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
  // Auth / session (HeroIcons v2 renamed these; v1 names kept too)
  ArrowRightEndOnRectangleIcon: "LogIn",
  ArrowRightOnRectangleIcon: "LogIn",
  ArrowLeftStartOnRectangleIcon: "LogOut",
  ArrowRightStartOnRectangleIcon: "LogOut",
  ArrowLeftOnRectangleIcon: "LogOut",
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

/** `MapPin` / `mapPin` / `MAPPin` → `map-pin`. Digits start their own
 *  segment so `Building2` becomes `building-2`, which is the module name. */
function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])(\d)/g, '$1-$2')
    .toLowerCase();
}

/** `PascalCase` for the `lucide` barrel's export names. */
function toPascal(kebab: string): string {
  return kebab.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

/**
 * Any stored spelling → the canonical kebab lucide name. Returns `''` for
 * input that cannot be a name at all; it does **not** verify the icon exists,
 * because existence is the registry's question and this is only spelling.
 */
export function normalizeIconName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const name = raw.trim();
  if (!name) return '';

  const aliased = HEROICON_ALIASES[name];
  if (aliased) return toKebab(aliased);

  // `ActivityIcon` → `Activity`. Applies to lucide-react's suffixed aliases
  // (what the picker writes) and to any HeroIcon name the table above missed
  // whose Lucide equivalent kept the same stem.
  const stem = name.endsWith('Icon') && name.length > 4 ? name.slice(0, -4) : name;
  return toKebab(stem);
}

// ─── Geometry ───────────────────────────────────────────────────────────────

/** A lucide icon: the children of its 24×24 `<svg>`, as `[tag, attrs]`. */
export type IconNode = ReadonlyArray<readonly [string, Record<string, any>]>;

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

/** `"1,2 3,4"` or `"1 2 3 4"` → `[[1,2],[3,4]]`. */
function parsePoints(raw: unknown): Array<[number, number]> {
  const nums = String(raw ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * An icon's shapes as SVG path data — one string per element.
 *
 * Lucide draws with seven tags (`path`, `circle`, `rect`, `line`, `ellipse`,
 * `polyline`, `polygon`); everything but `path` is expanded here so callers
 * only ever handle path data. That is what lets the same geometry feed
 * `Path2D` on the 2D canvas and a texture in 3D without either knowing what an
 * ellipse is.
 *
 * Kept free of `Path2D` deliberately — this is pure string work, runs under
 * the test runner with no DOM, and the browser-only construction stays at the
 * two call sites that actually paint.
 */
export function iconNodeToPathData(node: IconNode | null | undefined): string[] {
  if (!node) return [];
  const out: string[] = [];

  for (const entry of node) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [tag, a] = entry;
    switch (tag) {
      case 'path': {
        const d = a?.d;
        if (typeof d === 'string' && d.trim()) out.push(d);
        break;
      }
      case 'circle': {
        const cx = num(a?.cx), cy = num(a?.cy), r = num(a?.r);
        if (r > 0) out.push(ellipsePath(cx, cy, r, r));
        break;
      }
      case 'ellipse': {
        const cx = num(a?.cx), cy = num(a?.cy);
        const rx = num(a?.rx), ry = num(a?.ry);
        if (rx > 0 && ry > 0) out.push(ellipsePath(cx, cy, rx, ry));
        break;
      }
      case 'rect': {
        const x = num(a?.x), y = num(a?.y);
        const w = num(a?.width), h = num(a?.height);
        if (w <= 0 || h <= 0) break;
        // `rx` alone implies `ry` in SVG, and vice versa.
        const rxRaw = a?.rx ?? a?.ry;
        const ryRaw = a?.ry ?? a?.rx;
        const rx = Math.min(num(rxRaw), w / 2);
        const ry = Math.min(num(ryRaw), h / 2);
        out.push(rx > 0 && ry > 0 ? roundedRectPath(x, y, w, h, rx, ry) : rectPath(x, y, w, h));
        break;
      }
      case 'line': {
        out.push(`M${num(a?.x1)} ${num(a?.y1)}L${num(a?.x2)} ${num(a?.y2)}`);
        break;
      }
      case 'polyline':
      case 'polygon': {
        const pts = parsePoints(a?.points);
        if (pts.length < 2) break;
        const d = `M${pts[0][0]} ${pts[0][1]}` + pts.slice(1).map(([x, y]) => `L${x} ${y}`).join('');
        out.push(tag === 'polygon' ? `${d}Z` : d);
        break;
      }
      default:
        break;
    }
  }

  return out;
}

/** Two half-arcs — the only form that closes cleanly for a full ellipse
 *  (a single arc to the same point is degenerate and renders nothing). */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}

function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${x} ${y}h${w}v${h}h${-w}Z`;
}

function roundedRectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  return (
    `M${x + rx} ${y}` +
    `h${w - rx * 2}` +
    `a${rx} ${ry} 0 0 1 ${rx} ${ry}` +
    `v${h - ry * 2}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
    `h${-(w - rx * 2)}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
    `v${-(h - ry * 2)}` +
    `a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
  );
}

// ─── Registry ───────────────────────────────────────────────────────────────

import {
  Activity, Building2, Calendar, CircleDot, Clock, FileText, Flag, Landmark,
  Lightbulb, MapPin, Quote, Scale, Scroll, Target, User, Waypoints,
} from 'lucide';

/** Statically bundled: the glyphs a graph paints when nobody declared
 *  anything. Named imports so the bundler keeps these and only these. */
const BUILTIN: Record<string, IconNode> = {
  'activity': Activity,
  'building-2': Building2,
  'calendar': Calendar,
  'circle-dot': CircleDot,
  'clock': Clock,
  'file-text': FileText,
  'flag': Flag,
  'landmark': Landmark,
  'lightbulb': Lightbulb,
  'map-pin': MapPin,
  'quote': Quote,
  'scale': Scale,
  'scroll': Scroll,
  'target': Target,
  'user': User,
  'waypoints': Waypoints,
};

/**
 * The glyph a node type wears when its author said nothing.
 *
 * Covers the classical NER types the old table had, plus the four the
 * observation model prescribes (`sections.py`) — Event, Observation, Interest,
 * Evidence — which had no default at all because the table predates them.
 */
export const DEFAULT_TYPE_ICONS: Record<string, string> = {
  PERSON: 'user',
  ORGANIZATION: 'building-2',
  COMPANY: 'building-2',
  INSTITUTION: 'landmark',
  STATE: 'landmark',
  LOCATION: 'map-pin',
  COUNTRY: 'flag',
  EVENT: 'calendar',
  DATE: 'clock',
  CONCEPT: 'lightbulb',
  INTEREST: 'target',
  POLICY: 'scroll',
  LEGISLATION: 'scale',
  DOCUMENT: 'file-text',
  EVIDENCE: 'quote',
  // Not `activity`: an interest is the type most often given that glyph by
  // hand, and two types wearing one picture is the same as neither wearing
  // one. An observation is a station on a path, which is what waypoints are.
  OBSERVATION: 'waypoints',
  OTHER: 'circle-dot',
};

/** Lazily loaded icons, and the in-flight promises that will fill them.
 *  Module scope so a remount of the graph repaints from cache rather than
 *  re-fetching the barrel. */
const loaded = new Map<string, IconNode | null>();
let barrel: Promise<Record<string, IconNode>> | null = null;

/**
 * The icon's geometry, if it is already in hand — a builtin, or something a
 * previous `loadIconNode` resolved. Never blocks and never fetches, so a
 * paint callback can call it per frame.
 */
export function getIconNode(name: string | null | undefined): IconNode | null {
  const key = normalizeIconName(name);
  if (!key) return null;
  return BUILTIN[key] ?? loaded.get(key) ?? null;
}

/**
 * The icon's geometry, fetching the full lucide table if this is the first
 * name outside the builtin set. Resolves to `null` for a name lucide does not
 * have — a stored glyph from an icon set we no longer ship, which should
 * degrade to no icon rather than to an exception on the render path.
 */
export async function loadIconNode(name: string | null | undefined): Promise<IconNode | null> {
  const key = normalizeIconName(name);
  if (!key) return null;
  const known = BUILTIN[key] ?? loaded.get(key);
  if (known !== undefined) return known;

  try {
    barrel ??= import('lucide').then(m => m as unknown as Record<string, IconNode>);
    const mod = await barrel;
    const node = mod[toPascal(key)] ?? null;
    loaded.set(key, node);
    return node;
  } catch {
    // Chunk load failure: remember nothing, so a later attempt can retry.
    return null;
  }
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Which icon a node type wears. The precedence mirrors `resolveEntityColor`
 * exactly — one chain, so a type cannot take its colour from the schema and
 * its icon from somewhere else.
 *
 * Returns `null` rather than a fallback glyph when nothing matches: an
 * undeclared, unknown type should render as a plain node, not as a wrong
 * picture of what it is.
 */
export interface IconOverrides {
  /** Infospace-level, highest priority. Reserved — no surface writes these
   *  yet, present so the chain matches colours rather than diverging later. */
  infospaceIcons?: Record<string, string>;
  /** What the schema's author declared, keyed by node type. */
  schemaIcons?: Record<string, string>;
}

export function resolveEntityIcon(
  type: string | null | undefined,
  overrides?: IconOverrides,
  options?: { includeDefaults?: boolean },
): string | null {
  const key = String(type ?? '').toUpperCase();
  if (!key) return null;

  const declared = overrides?.infospaceIcons?.[key] ?? overrides?.schemaIcons?.[key];
  if (declared) return normalizeIconName(declared) || null;

  if (options?.includeDefaults === false) return null;
  return DEFAULT_TYPE_ICONS[key] ?? null;
}
