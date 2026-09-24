"""A parts catalog as a ship recipe may read it.

A recipe that lists a catalog under `records` in its recipe-inputs.json names the entries it uses. During
ship:build the pipeline writes a copy holding only those entries and names it in SHIP_RECORDS, so the
ship's fingerprint hashes just them and publishing any other part leaves the ship current. Outside the
pipeline (Blender MCP, a manual run) this reads the whole catalog.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def catalog(path):
    """The catalog at a repository path such as 'assets/parts/construction.json'."""
    trimmed = json.loads(os.environ.get('SHIP_RECORDS') or '{}').get(path)
    return json.loads(Path(trimmed).read_text() if trimmed else (ROOT / path).read_text())
