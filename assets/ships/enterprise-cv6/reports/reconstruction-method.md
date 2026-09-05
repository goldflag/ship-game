# Enterprise: references and reconstruction method

Target: USS Enterprise (CV-6), Battle of Midway, June 1942. This is an original
reconstruction in progress. It combines Enterprise contract drawings, class
as-built drawings, and dated Enterprise photographs. These sources do not yet
resolve every feature of the actual June 1942 ship.

## Reference material actually used

| Material | What it contributes | Limitation |
|---|---|---|
| [CV-6 Navy drawing collection](https://archive.org/details/cv6ga1934), originating from [National Archives record 175662092](https://catalog.archives.gov/id/175662092) | Body plan and molded offsets C&R 189522; inboard profile C&R 189525; island arrangements C&R 189526; midship/type sections C&R 189523 | Design/contract evidence; individual drawing dates vary. Some collected sheets show proposed alterations. These are not all June 1942 as-built drawings. |
| [Yorktown CV-5, February 1940 Booklet of General Plans](https://archive.org/details/cv5bogp1940) — [PDF](https://ia800902.us.archive.org/0/items/cv5bogp1940/cv5bogp1940.pdf) | Explicit class dimensions, frame grid, island levels, elevators, rudder datums, shafts and exterior belt extent | A sister ship. Enterprise-specific differences remain to be established. |
| [Enterprise island front, Navy photo 19-N-29691](https://www.navsource.net/archives/02/020694.jpg) | CXAM-1 radar and the two forward quadruple 1.1-inch mounts, circa March 1942 | Perspective photograph, used qualitatively. |
| [Enterprise island side, Navy photo 19-N-29696](https://www.navsource.net/archives/02/020644.jpg) | Stack, searchlight platforms, cranes and visible small-gun arrangement, circa March 1942 | Perspective photograph, used qualitatively. |
| [Enterprise, 26 May 1942](https://www.navsource.net/archives/02/020622.jpg) and [4 June 1942](https://www.navsource.net/archives/02/020619.jpg) | Overall pre-Midway/Midway appearance and silhouette | No completed camera-matched silhouette-error measurement. Dates and original photo credits are in the [photo index](https://www.navsource.net/archives/02/06a.htm). |
| [NHHC official Enterprise history](https://www.history.navy.mil/research/histories/ship-histories/danfs/e/enterprise-cv-6-vii.html) | Published length/beam and alteration chronology; thirty 20 mm guns installed during March 1942 | The dimensional header mixes conditions/configurations; it is not a Midway survey. |
| [NavSource as-built specifications](https://www.navsource.net/archives/02/06.htm) | Flight-deck and elevator headline dimensions and reference draft | Secondary data requiring reconciliation with dated drawings. |
| [Task Force 17 class data](https://www.oocities.org/~taskforce-17/Yorktown.html) | Provisional 12 ft 7 in propeller diameter | Weak secondary evidence with a contradictory rudder count. Propeller dimensions/pitch remain open. |

The [complete source register](../references/sources.json) includes retained file
names, SHA-256 hashes, provenance, individual limitations and inspection crops.
Original scans stay under `assets/`, outside the served game files. No commercial
game mesh or texture has been copied; GameModels3D has not been used for this ship.

## How the geometry has been fitted

1. **Separate datums and configuration.** Imperial annotations are converted using
   exactly 0.3048 metres per foot. Steel-hull length, flight-deck overhang, molded
   breadth, exterior breadth, baseline and waterline are kept distinct. The
   25 ft 11½ in draft is a declared reference loading condition, not a measured
   Midway draft.
2. **Reconstruct the hull from offsets.** Selected tabulated half-breadths are
   transcribed in [the CSV](../authoring/hull-offsets.csv), preserving the
   feet/inches/eighths notation. The [blueprint generator](../authoring/generate_blueprint.py)
   converts these into a loft with 50 longitudinal sections. Lower bilges,
   missing values, end sections and portions of the sheer remain interpolated.
   This is not yet a complete, independently audited transcription.
3. **Place structures on the drawing grid.** Four-foot frames and annotated
   elevations locate island platforms, bridge levels, funnel, elevators and
   appendages. Polygon outlines and several mount positions are measured or
   estimated manually from plans and photos. Class-derived dimensions are
   recorded as such.
4. **Correct findings in the durable recipe.** Reading C&R 189525 replaced the
   provisional 77½-ft flight-deck height with its 80-ft molded centerline datum.
   Its 4-inch camber over 92 ft now drives a parabolic deck crown. Meshes are
   divided into transverse strips before bending. The exact wood-surface
   allowance and as-built curve still need confirmation. See the
   [actual annotation crop](../references/details/flight-deck-annotation.png).
5. **Distinguish molded hull from exterior armor.** A separate tapered belt adds
   the section drawing's 4-to-2½-inch armor. Its frame extent uses the class
   outboard profile; a ⅝-inch shell allowance is inferred from class breadth
   data. This substantially reduces the beam discrepancy without rescaling the
   original offset transcription. The inferred allowance and end profiles
   remain provisional.
6. **Measure the exported geometry independently.** The [dimension audit](../authoring/measure_export.py)
   reads actual GLB vertices, transforms and triangle intersections. It checks
   lengths, widths, deck height/camber, waterline breadth and rudder side area.
   This catches conversion, scale, export and geometry errors that checking
   JSON numbers alone would miss.
7. **Review shape and motion.** The shared pipeline produces profile, plan, bow,
   stern and quarter orthographic views with retained camera settings. Renderer
   tests and the recorded runtime review exercise all 54 muzzle chains through
   traverse, elevation and recoil. The latest gameplay review has also observed
   firing and armor-stopped hits; damage/flooding and reset review remain open.

## Selected exported measurements

These figures measure agreement with the chosen dimensional targets. They do not
state the historical uncertainty of those targets or the complete shape.

| Measurement | Reference target | Actual model |
|---|---:|---:|
| Steel hull length | 246.7356 m | 246.7356 m |
| Flight-deck overall extent | 244.4496 × 26.2128 m | 244.4496 × 26.2128 m |
| Elevator platform extent | 14.6304 × 13.4112 m | Same to within 0.01 mm of numerical export precision |
| Flight-deck molded centerline above baseline | 24.3840 m | 24.3840 m |
| Exterior breadth, compared with NHHC beam | 25.3238 m | 25.3279 m: +4.1 mm; inferred exterior allowance |
| Class rudder projected area | 36.8825 m² | 36.8825 m²; fitted outline still provisional |

Full values, evidence notes and the model hash are in [dimensions.json](dimensions.json).
The 54-barrel runtime record is in [runtime-articulation.json](runtime-articulation.json);
its recorded hash identifies the particular reviewed build.

Open the current [profile](../generated/review/profile.png),
[plan](../generated/review/plan.png), [bow](../generated/review/bow.png),
[stern](../generated/review/stern.png), or [quarter view](../generated/review/quarter.png).
These fixed views make comparison repeatable. A quantitative overlay against a
fully digitized, dated Enterprise plan and calibrated photograph cameras has
**not** yet been completed. No photogrammetric reconstruction or automatic
silhouette fitting has been performed.

The [discrepancy register](discrepancies.md) tracks the remaining hull curves,
deck perimeter, island differences, gun placements, boats, appendages, paint and
fittings. The earlier approximate 80% progress estimate was a work-completion
estimate, not a measured historical accuracy score.
