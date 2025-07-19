# Views Configuration Guide

> **Status:** ✅ **Complete & Ready for Use**  
> **Purpose:** Guide for structuring and using the `views_config` on `AnnotationRun` to create shareable, reproducible analysis dashboards.

---

## 🎯 **Overview**

The Views Configuration system transforms an annotation run from a simple data container into a fully-fledged, shareable analytical workspace. Instead of just storing annotation results, a run can now also store the entire configuration for a multi-panel dashboard, allowing users to save, share, and reproduce complex analytical views.

This moves filtering, sorting, and display logic from ephemeral frontend state into a persistent, backend-stored configuration on the `AnnotationRun` model.

**Key Features:**
- **Multi-Panel Dashboards:** Define layouts with multiple, independent visualizations (tables, maps, charts) visible at once.
- **Independent Configuration:** Each panel has its own set of filters, exclusions, and display settings.
- **Reproducible Analysis:** Sharing a run also shares the exact visual layout and analytical configuration.
- **User-Friendly Naming:** Views and panels can be given descriptive names and descriptions.

---

## 🏗️ **Core Data Structure**

The `AnnotationRun.views_config` field stores a single `DashboardConfig` object. This object is the blueprint for the entire dashboard.

### **`DashboardConfig`**

This is the top-level object stored in `AnnotationRun.views_config`.

```json
{
  "name": "Cybersecurity Threat Overview",
  "description": "Dashboard for monitoring infrastructure-related threats.",
  "layout": {
    "type": "grid",
    "columns": 2
  },
  "panels": [
    // Array of PanelViewConfig objects
    { ... },
    { ... }
  ]
}
```

### **`PanelViewConfig`**

Each object in the `panels` array defines a single visualization panel on the dashboard.

```json
{
  "id": "panel_1a2b3c",
  "name": "High-Severity Events Map",
  "description": "Geolocated view of events with a severity score of 8 or higher.",
  "type": "map",
  "filters": {
    "logic": "and",
    "rules": [
      {
        "schemaId": 101,
        "fieldKey": "severity_score",
        "operator": "greater_than",
        "value": 8,
        "isActive": true
      }
    ]
  },
  "exclusions": {
    "assetIds": [501, 502]
  },
  "displaySettings": {
    "map": {
      "geocodeSource": { "schemaId": 101, "fieldKey": "location" },
      "labelSource": { "schemaId": 101, "fieldKey": "threat_type" },
      "showLabels": true
    },
    "table": {},
    "chart": {},
    "pie": {},
    "graph": {}
  }
}
```

---

## 🔧 **Field Definitions**

### `DashboardConfig`
- **`name`** (`string`): The overall name for the dashboard configuration.
- **`description`** (`string`, optional): A description of the dashboard's purpose.
- **`layout`** (`object`): Defines the arrangement of panels.
  - **`type`** (`string`): The layout type (e.g., `"grid"`).
  - **`columns`** (`number`): Number of columns in the grid.
- **`panels`** (`PanelViewConfig[]`): An array of panel configurations.

### `PanelViewConfig`
- **`id`** (`string`): A unique, client-generated ID for the panel (e.g., `nanoid()`). Used for React keys and managing updates.
- **`name`** (`string`): The user-defined title of the panel.
- **`description`** (`string`, optional): A description explaining what the panel shows.
- **`type`** (`'table' | 'map' | 'chart' | 'pie' | 'graph'`): The type of visualization to render for this panel.
- **`filters`** (`object`): The filtering rules specific to this panel.
  - **`logic`** (`'and' | 'or'`): How to combine multiple filter rules.
  - **`rules`** (`ResultFilter[]`): An array of filter rule objects, matching the structure used by the frontend `AnnotationResultFilters` component.
- **`exclusions`** (`object`): Defines items explicitly excluded from this panel's view.
  - **`assetIds`** (`number[]`): A list of asset IDs to hide.
- **`displaySettings`** (`object`): A container for settings specific to each visualization type. Only the settings corresponding to the panel's `type` will be used.
  - **`map`**: Configuration for `AnnotationResultsMap`.
  - **`chart`**: Configuration for `AnnotationResultsChart`.
  - **`table`**: Configuration for `AnnotationResultsTable`.
  - ...and so on.

---

## 🔄 **Workflow & Interaction Pattern**

1.  **Fetch:** When a user selects an `AnnotationRun`, the frontend fetches the run data, including the `views_config` field which contains the `DashboardConfig`.
2.  **Render:** The `AnnotationRunner` component reads the `DashboardConfig`. It iterates over the `panels` array. For each `PanelViewConfig` object, it renders the appropriate component (e.g., `AnnotationResultsMap` for `type: 'map'`) and passes the entire `PanelViewConfig` object as a prop.
3.  **Filter:** Each panel component receives the full, unfiltered set of results for the run. It then applies its own filtering logic based on the `filters` and `exclusions` from its dedicated `PanelViewConfig`.
4.  **Configure:** When a user interacts with controls within a panel (e.g., changes a filter in a table), the frontend state for that panel's `PanelViewConfig` is updated. A "dirty" flag is set for the dashboard.
5.  **Save:** The user clicks a global "Save Dashboard" button. The frontend takes the current `DashboardConfig` object (with all the updated panel configurations) and sends it to the backend via a `PATCH` request to `/api/v1/infospaces/{infospace_id}/runs/{run_id}`.

This architecture ensures that each panel is independent and self-contained, enabling the powerful, multi-view analytical experience you envisioned. It also makes the entire analytical setup portable and shareable by embedding it directly within the `AnnotationRun` itself. 