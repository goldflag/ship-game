"""Build the self-contained review artifact from the retained runtime captures."""
import base64
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
review = root / 'assets/effects/naval/review'


def data(path, mime):
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()


posters = {name: data(review / f'{name}.webp', 'image/webp') for name in ['broadside', 'smoke', 'splash', 'armor']}
videos = {name: data(review / f'{name}.webm', 'video/webm') for name in ['smoke', 'broadside', 'splash', 'armor']}
media = {
    'smoke': {'title': 'Propellant smoke drifting and softening beside Bismarck', 'caption': 'Watch at normal speed: the blast expands quickly, then broad smoke lobes drift and soften. Their motion settles as the plume spreads.'},
    'broadside': {'title': 'Bismarck firing its main battery', 'caption': 'A large fireball rolls out from the guns, then cools into sunlit, billowing smoke. Play at quarter speed to follow the transition.'},
    'splash': {'title': 'Shell impacts rising from the ocean', 'caption': 'Water columns rise and break into spray. Heavy droplets fall under gravity, low mist spreads, and disturbed water leaves foam on the ocean surface.'},
    'armor': {'title': 'Shells striking the target armor', 'caption': 'Shells arrive along their ballistic trajectories. Armor contact produces a short flash, directional sparks and gray smoke, with damage resolved by the simulation.'},
}
for name in media:
    media[name].update(poster=posters[name], video=videos[name])
html = (root / 'scripts/diagnostics/combat-artifact.html').read_text()
tokens = {
    'BODY_FONT': data(root / 'node_modules/@fontsource/barlow/files/barlow-latin-400-normal.woff2', 'font/woff2'),
    'DISPLAY_FONT': data(root / 'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2', 'font/woff2'),
    'BROAD_POSTER': posters['broadside'], 'SMOKE_POSTER': posters['smoke'], 'SPLASH_POSTER': posters['splash'],
    'MEDIA': json.dumps(media),
}
for key, value in tokens.items():
    html = html.replace(f'__{key}__', value)
output = root / 'assets/effects/naval/review/artifact.html'
output.write_text(html)
print(f'{output}: {output.stat().st_size:,} bytes')
