"""Live RSS ingestion (M2): fetch -> parse -> normalize -> service with demo fallback.

Modules:
- `rss_fetch` - bounded, on-demand HTTP fetching with typed errors.
- `rss_parser` - stdlib-only RSS 2.0 parsing (namespace-agnostic).
- `pravda_adapter` - normalization to the M1 `Article` schema (excerpt-only).
- `service` - live-first entry point with demo fallback for offline operation.

Offline-first guarantee: unit tests inject fake fetchers and never touch the
network (AGENTS.md rule 17). See docs/ingestion.md for the full policy.
"""
