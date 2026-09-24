# Terrain assets

The battle terrain (`src/game/terrain/`) draws its close-range detail from aerial photographs. Those below
are CC0, from [Poly Haven](https://polyhaven.com/license); the game serves its own local copies and makes
no third-party requests at runtime. It also reuses the harbor's `rock-color.jpg` (Aerial Rocks 02) and
`ground-color.jpg` (Aerial Grass Rock), credited in [public/harbor/ASSETS.md](../harbor/ASSETS.md).

| Runtime asset | Source | Artist | Ground covered by one repeat |
| --- | --- | --- | --- |
| sand-color.jpg | [Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01), 1K diffuse | Rob Tuytel | 30 m |
| snow-color.jpg | [Snow Field Aerial](https://polyhaven.com/a/snow_field_aerial), 1K colour | Rob Tuytel | 80 m |

The terrain uses only each photograph's luminance, relative to its mean, as structure under colours it
chooses itself (`TerrainTextures.ts`). Everything else it draws (the noise tile, tree crowns, fields and
hedgerows) is generated procedurally at runtime.
