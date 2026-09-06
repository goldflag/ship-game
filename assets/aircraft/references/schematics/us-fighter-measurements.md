# US carrier fighter shape measurements

These three source sets were actually opened and visually measured. The shape definitions are individualized outline measurements, not a rescaled shared fighter template. `measure-us-fighters.py` retains raw pixel landmarks and the conversion to meters; `review-us-fighter-measurements.py` renders the reference registration overlays. Both scripts run from repository root.

| Aircraft | Main drawing | Provenance and limitations |
| --- | --- | --- |
| F4F-4 Wildcat | [Kaboldy, F4F-4 orthographic drawing](https://commons.wikimedia.org/wiki/File:Grumman_F4F_Wildcat_3-view_line_drawing.svg) | Original SVG plus 960-pixel raster, CC BY-SA 3.0. Modern drawing, not a factory loft. |
| F6F-5 Hellcat | [Kaboldy, F6F orthographic drawing](https://commons.wikimedia.org/wiki/File:Grumman_F6F_Hellcat_3-view_line_drawing.svg), checked against [Ssawka, F6F-5](https://commons.wikimedia.org/wiki/File:Grumman_F6F-5_Hellcat_2002.png) | Original SVG plus raster, CC BY-SA 4.0; exact -5 drawing retained under CC BY 2.5. Modern drawings, not factory lofts. |
| F4U-1D Corsair | [Vought Heritage, drawing 1532_016](https://www.vought.org/photo/html/pdown.html) | Explicit F4U-1D manufacturer/archive three-view with written dimensions. Original GIF retained. [Kaboldy family drawing](https://commons.wikimedia.org/wiki/File:Vought_F4U-1_Corsair_3-view.svg) is a secondary outline/detail cross-check, CC BY-SA 3.0. |

All raster and original drawing credits remain with their authors. Reference images are analysis material; they are not applied to the independent meshes as textures. Overlay images add measured landmarks and retain the original drawing underneath. Each reference directory includes source URLs, licensing notes, original SHA-256 hashes and the complete registrations in `source.json`.

## Reviewed outline results

The red planform paths in each `registration-overlay.png` track the preserved drawing's actual wing and tail edges. Purple paths follow each individual fin silhouette. Orange paths follow the side body envelope except where canopy, wing roots and tail surfaces hide it. Blue paths follow the canopy roof. F4F/F6F side views and plan views use separately registered length/span scales, differing by about one percent within their source drawings.

- Wildcat: near rectangular wing with rounded clipped ends, deep short fuselage, strong curved fin leading edge, short framed canopy, raised wing and fuselage-mounted narrow-track gear. Measured tail span 4.15 m and wing plan area 23.80 m².
- Hellcat: broader root chord tapering to rounded tips, deep cowling/chin intake and dorsal spine, a different rounded fin outline, low wing and wide-track main gear. Measured tail span 5.78 m and wing plan area 30.68 m². Exact -5 finish removes the earlier rear quarter glazing.
- Corsair: long forward fuselage, aft cockpit with clear hood, deep gull break at 35.8 percent of half-span, broad rounded wing ends and curved fin. Primary drawing explicitly specifies 16 ft 6 in / 5.0292 m horizontal tail span and 12 ft 1 in / 3.683 m gear track. Measured wing plan area 28.68 m².

These are silhouette and dimensional checks, not a claim of complete historical accuracy. Elliptical fuselage cross sections, hidden wing roots, exact airfoil sections, tire compression, deployed gear kinematics, small fittings and paint weathering remain reconstructions. The Vought sheet's early 13 ft 4 in propeller differs from the later 13 ft 1 in propeller described by the [Smithsonian F4U-1D record](https://airandspace.si.edu/collection-objects/vought-f4u-1d-corsair/nasm_A19610124000); the model specification selects the later diameter and records this variant difference.
