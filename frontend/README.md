# Frontend

Next.js + React + TypeScript. The web interface for Open Politics HQ, providing research workflows for content ingestion, schema-based analysis, and intelligence chat.

## Quick Start

```bash
# From project root
docker compose up -d
```

Frontend runs at http://localhost

## Architecture Philosophy

The frontend is organized around **workspaces** (Infospaces) containing **assets** (content), **bundles** (collections), and **schemas** (analytical frameworks). The UI provides multiple views into this structure.

### Data Flow Pattern

**API Client → Zustand Stores → Components → User Actions → API Client**

1. **API Client** (`src/client/`) - Auto-generated from backend OpenAPI spec
2. **Zustand Stores** (`src/zustand_stores/`) - Global state management
3. **Components** (`src/components/`) - UI presentation layer
4. **Hooks** (`src/hooks/`) - Reusable data fetching and state logic

**Key Pattern:** Components subscribe to stores. User actions trigger store methods. Store methods call API client. API responses update store state.

### View Orchestration

The app has three primary interaction modes:

**Asset Management** → Browse/upload/organize content  
**Schema Execution** → Define analytical frameworks and run them  
**Intelligence Chat** → Query and analyze content conversationally

Each mode lives in its own route but shares underlying state through Zustand stores.

## Core Architectural Patterns

### 1. Tree-Based Data Loading

The asset/bundle hierarchy uses efficient tree navigation:

**TreeStore Pattern:**
- Single API call loads root-level bundles and standalone assets
- Lazy-load children when user expands tree nodes
- Cache full asset data only when viewing details
- Result: 90-95% reduction in initial load time

This replaces the old N+1 query pattern. Components subscribe to `useTreeStore()` and call `fetchChildren()` on expand.

### 2. Generated API Client

Backend changes automatically propagate to frontend:

**Workflow:**
1. Backend changes OpenAPI spec
2. Run `./generate-client.sh`
3. TypeScript client regenerates with new types
4. TypeScript catches any breaking changes

All API calls use this client. No manual fetch logic. Full type safety from backend to frontend.

### 3. Asset Kind-Based Rendering

Assets have a `kind` field that determines rendering:

**AssetDetailView Pattern:**
- Route through switch statement based on `asset.kind`
- Each kind has specialized viewer component
- PDF → `PdfViewer`, CSV → `EditableCsvViewer`, Article → `ArticleView`
- Viewers handle their own specifics (page navigation, inline editing, etc.)

This means adding a new content type requires: backend handler/processor + frontend viewer component.

### 4. Schema Run Orchestration

Schema execution is a multi-step workflow:

**Run Lifecycle:**
1. User creates AnnotationRun (selects schemas + target assets)
2. Frontend calls API to create run
3. Backend queues Celery task
4. Frontend polls run status endpoint
5. When complete, frontend fetches and displays results

Components use `useAnnotationSystem()` hook for the full workflow. The hook manages polling, error handling, and result formatting.

### 5. Chat Tool Calling

Intelligence chat implements structured tool calling:

**Chat Flow:**
1. User sends message
2. Hook streams response from backend
3. Backend LLM can call tools (search, navigate, analyze)
4. Tool results are rendered in-line with custom components
5. LLM sees results and continues response

Tool renderers are registered in `components/collection/chat/toolcalls/`. Each tool has a custom result display component.

## State Management Patterns

### Zustand Store Architecture

Each domain has its own store:

- **storeInfospace**: Active workspace, workspace list
- **storeTree**: Asset/bundle tree structure
- **storeAssets**: Asset CRUD operations
- **storeBundles**: Bundle CRUD operations
- **useAnnotationRunStore**: Schema runs and results
- **storeChatHistory**: Chat conversations and messages

**Pattern:** Stores expose state and actions. Components call actions, subscribe to state changes.

### Server State vs Local State

**Server State** (Zustand stores):
- Asset lists, bundle contents, run results
- Persisted across page navigation
- Source of truth is backend

**Local State** (React useState):
- API Keys
- UI flags (modals open, selected items, filters)
- Form inputs during editing
- Transient display state

This separation means page refreshes restore data but reset UI state.

### Tree Store Efficiency

**Tree Store Data Pattern:**
- Root fetch returns only: id, title, kind, type (asset/bundle), child count
- Full asset data fetched only when viewing details
- Children lazy-loaded on expand
- Cache keyed by parent ID

## Component Patterns

### Asset Management

**AssetManager** is the primary content browser:

- Three-panel layout: tree navigation + asset list + detail view
- Tree shows bundles and standalone assets hierarchically
- Detail view switches based on asset kind
- Actions: upload, create, edit, delete, move to bundle

Pattern: Manager orchestrates layout. Detail views are content-specific.

### Schema Builder

**SchemaBuilder** lets users define extraction frameworks:

- Field definition with types (string, number, boolean, array, object)
- Natural language instructions per field
- Live JSON preview
- Save as reusable template

Pattern: JSON schema editor with natural language annotations. Backend validates schema structure.

### Annotation Runner

**AnnotationRunner** executes schemas against assets:

- Select schemas and target assets
- Configure run parameters (context window, parent inclusion)
- Monitor progress with status polling
- Display results in tables and charts

Pattern: Configuration → Execution → Polling → Results display.

### Intelligence Chat

**Chat** component implements conversational interface:

- Streaming LLM responses
- Tool execution visualization
- Conversation history and management
- Asset detail popup from tool results

Pattern: Message list with real-time streaming. Tool results rendered inline with custom components.

## Page Structure

```
frontend/src/app/
├── hq/                           # Main application
│   ├── layout.tsx                # App layout with navigation
│   ├── infospaces/               # Workspace management
│   │   ├── asset-manager/        # Asset browser and upload
│   │   ├── annotation-runner/    # Schema execution
│   │   └── annotation-schemes/   # Schema management
│   └── chat/                     # Intelligence chat
└── accounts/                     # Authentication pages
```

Routes use Next.js App Router. Layout wraps all `/hq/*` pages with navigation and infospace selector.

## Development Workflow

### Local Development

`compose.override.yml` enables hot reload:

```bash
docker compose up --build
# Edit files in src/, changes appear immediately
```

Or run outside Docker:
```bash
cd frontend
npm install
npm run dev  # Runs at http://localhost:3000
```

### Regenerating API Client

After backend changes:

```bash
./generate-client.sh
```

Requires Node.js (via nvm) and `jq` for JSON processing. Script fetches OpenAPI spec and generates TypeScript client.

### Adding a New Page

1. Create in `src/app/hq/yourpage/page.tsx`
2. Import components from `@/components`
3. Use stores for data fetching

Layout is inherited from parent `layout.tsx`.

### Adding a New Component

1. Create in `src/components/collection/yourfeature/`
2. Use shadcn/ui primitives for consistency
3. Import types from `@/client/types.gen`

Follow existing component patterns for store subscription and data fetching.

## Asset Viewer Components

Each asset kind has a specialized viewer:

- **PdfViewer**: Page navigation, zoom controls, text extraction display
- **EditableCsvViewer**: Inline cell editing, column sorting, row filtering
- **ArticleView**: Rich content display, image gallery, metadata
- **ImageAssetView**: Image display with EXIF data and analysis results

Pattern: Viewer receives `asset` prop, handles its own display logic. Parent manages data loading and actions.

## Tool Result Rendering

Chat tool results use a registry pattern:

**Tool Registry:**
1. Tool defines result renderer in `toolcalls/renderers/`
2. Renderer registers with `toolResultRegistry`
3. Chat component looks up renderer by tool name
4. Falls back to generic JSON display if no renderer

This means adding chat tools requires: backend tool definition + frontend result renderer.

## Styling

Tailwind CSS + shadcn/ui components:

- Global styles in `globals.css`
- Theme variables in CSS custom properties
- Component styles via Tailwind utility classes
- No CSS modules or styled-components

Pattern: Compose Tailwind classes. Use shadcn/ui for complex components (dialogs, dropdowns, etc.).

## Key Directories

- `src/app/` - Next.js routes and pages
- `src/components/collection/` - Main app components
- `src/components/ui/` - Reusable UI primitives (shadcn/ui)
- `src/hooks/` - Custom React hooks for data fetching
- `src/zustand_stores/` - Global state management
- `src/client/` - Auto-generated API client
- `src/lib/` - Utilities and helper functions

## Configuration

Environment variables in `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost/api
```

Frontend makes all API calls through this base URL.

## Understanding the Codebase

Start by reading these in order:

1. `src/zustand_stores/storeInfospace.tsx` - Workspace state pattern
2. `src/zustand_stores/storeTree.tsx` - Tree loading optimization
3. `src/components/collection/assets/AssetManager.tsx` - Main UI orchestration
4. `src/hooks/useAnnotationSystem.tsx` - Schema run workflow
5. `src/hooks/useIntelligenceChat.tsx` - Chat streaming and tool calling

Pattern repeats: Stores manage state, hooks manage workflows, components render UI.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **State:** Zustand
- **API Client:** OpenAPI TypeScript Codegen
- **Maps:** Deck.gl + React Globe
- **Charts:** Recharts

## Resources

- **Next.js docs:** https://nextjs.org/docs
- **shadcn/ui:** https://ui.shadcn.com
- **Tailwind:** https://tailwindcss.com
- **Forum:** https://forum.open-politics.org
- **Dev meetings:** Wednesdays 15:30 Berlin Time
