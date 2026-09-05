# Harbor assets

All source assets below are CC0, from [Poly Haven](https://polyhaven.com/license).
The game serves its own local copies; there are no third-party requests at runtime.

| Runtime asset | Source | Artist |
| --- | --- | --- |
| ground-* | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) | Rob Tuytel |
| meadow-* | [Leafy Grass](https://polyhaven.com/a/leafy_grass) | Charlotte Baglioni |
| rock-* | [Aerial Rocks 02](https://polyhaven.com/a/aerial_rocks_02) | Rob Tuytel |
| brick-* | [Factory Brick](https://polyhaven.com/a/factory_brick) | Rob Tuytel |
| concrete-* | [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02) | Rob Tuytel |
| apron-* | [Concrete Floor Worn 001](https://polyhaven.com/a/concrete_floor_worn_001) | Dimitrios Savva, Rico Cilliers |
| cobbles-* | [Cobblestone Floor 04](https://polyhaven.com/a/cobblestone_floor_04) | Rob Tuytel |
| asphalt-* | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Rob Tuytel |
| slate-* | [Roof Slates 02](https://polyhaven.com/a/roof_slates_02) | Rob Tuytel |
| fir.glb, fir-impostor.png | [Fir Tree 01](https://polyhaven.com/a/fir_tree_01) | Rob Tuytel, Rico Cilliers |
| broadleaf.glb, broadleaf-impostor.png | [Tree Small 02](https://polyhaven.com/a/tree_small_02) | Rico Cilliers |
| coastal-rock.glb | [Rock 09](https://polyhaven.com/a/rock_09) | Jenelle van Heerden |
| cargo-crate.glb | [Wooden Military Crate](https://polyhaven.com/a/wooden_military_crate) | Prabhjinder Singh |
| cargo-barrel.glb | [Barrel 03](https://polyhaven.com/a/barrel_03) | Serhii Khromov |

The texture sets contain 1K albedo, OpenGL normal, and roughness maps. Tree
impostors are transparent Blender renders of the original geometry; nearby
trees and rock outcrops use simplified GLBs. The source download and Blender
export are reproducible with scripts/fetch-harbor-assets.py and
scripts/export-harbor-assets.py. Sources are retained in /tmp during the export.

Terrain, architecture, dock machinery, vessels, signage, and the harbor layout
are original procedural geometry authored for this game. This is an illustrative
North Atlantic setting, not a geographic reconstruction of a real naval base.

`period-facades.jpg` is an original generated texture atlas produced with the
built-in imagegen tool, then converted to JPEG for delivery. It is separate from
the CC0 library above. The complete prompt and production notes are recorded in
[generated-assets.md](../../docs/harbor/generated-assets.md).
