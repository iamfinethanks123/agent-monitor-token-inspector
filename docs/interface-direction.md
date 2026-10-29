# Inspector interface direction

The user wants the whole application to differ visibly from the upstream demo, while preserving beauty and prioritizing working features. Agent Monitor remains the source architecture; the primary runtime uses actual records and does not offer sample graphs.

The visual subject is a personal observability workbench: identify a task, inspect its evidence and compare its resource use across owned devices. The graph is a task map inside the same workspace, rather than a second dashboard with its own sidebar.

## Design tokens

- Graphite navy `#111927`: workspace background.
- Steel panel `#1b2739`: evidence and controls.
- Ice `#f0f4fb`: primary text and numeric values.
- Cobalt `#87a6f4`: selection, response usage and source links.
- Muted amber `#dfbd79`: partial evidence and attention states.
- Sage `#84c5ba`: successful/connected state, separate from selection.

Use Avenir Next with platform Traditional Chinese fallbacks for the interface, and the platform monospace only for exact values/identifiers. Group navigation by actual work: workspace, investigation and management. Use one shared header and one theme selector.

## Layout and restraint

The overview leads with the selected canonical USD/token total, then daily trend and composition, device comparison and the detailed time explorer. Account-wide totals and current limits live in one compact disclosure below the total; they stay mounted to preserve a successful dated reading across navigation, but querying remains explicit. The task map replaces the upstream recent-run sidebar with a horizontal source/session control row. Agent nodes use a compact evidence-card treatment and quiet connector lines; their status color communicates lifecycle, not verified success. Other screens share the same surfaces, spacing, form controls and evidence drawers.

No decorative numbering, sample agents, speculative status or manufactured relationships. Loading, empty, missing and conflicted states retain their meaning. Light mode uses a cool paper palette with the same hierarchy. Native screenshots must verify the final treatment and data state before calling the UI complete.
