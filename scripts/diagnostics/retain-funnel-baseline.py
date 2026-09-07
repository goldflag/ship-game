"""Retain the original sprite funnel recipe for a same-renderer A/B comparison.

Run from the repository root, then load the constructor in funnel-smoke.html.
python3 scripts/diagnostics/retain-funnel-baseline.py 365a6f446c04bfa25c73f4a71e3266f42be7c538
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path.cwd()
revision = subprocess.check_output(['git', 'rev-parse', '--verify', sys.argv[1] + '^{commit}'], text=True).strip()
output = root / '.build/funnel-smoke/baseline'
output.mkdir(parents=True, exist_ok=True)
hashes = {}
for name in ['ShipFunnelSmoke.ts', 'EffectParticles.ts']:
    source = subprocess.check_output(['git', 'show', f'{revision}:src/game/{name}'], text=True)
    hashes[name] = hashlib.sha256(source.encode()).hexdigest()

    def relocate(match):
        path = match.group(1)
        if path == './EffectParticles':
            return "from './EffectParticles'"
        if path.startswith('.'):
            absolute = (root / 'src/game' / path).resolve().relative_to(root)
            return f"from '/{absolute.as_posix()}'"
        return match.group(0)

    (output / name).write_text(re.sub(r"from '([^']+)'", relocate, source))
(output / 'revision.json').write_text(json.dumps({'commit': revision, 'sourceSha256': hashes}, indent=2) + '\n')
print(f'Retained original funnel smoke from {revision} in {output}')
