# Attachment inspection tools

Shared development checks, not a ship preset. `scan.py` checks bounding-box connectivity; `contact_scan.py` examines actual mesh contact; `check_open_mounts.py` checks original open gun components. Run with local Blender from the repository root. Inspect each script's scope and tolerances before interpreting results.

Diagnostic JSON goes to ignored `.build/ships/attachment-audit/`. Numerical connectivity does not prove historical accuracy or replace the four visual checks. The former archived verification workflow has been removed. Runtime inspection helpers remain development-only tools; keep new screenshots and telemetry in `.build/`.
