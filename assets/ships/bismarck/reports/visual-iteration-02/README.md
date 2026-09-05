# Bismarck · second exterior iteration

The ship now has a much denser, more complete exterior. The lower deckhouses step around the secondary turrets; the tower and directors have physical supports; the bridge has glazed openings, gallery shields and stairs. The funnel, light batteries, boats, hangars, cranes, mast rigging and deck machinery now read as individual equipment. Hull fairing rounds the coarse bilge and longitudinal transitions.

These comparisons use exactly the same orthographic cameras and spans as the previous iteration. The old authored image is cropped from its preserved sheet, without resizing. [Manifest](manifest.json) records both model hashes and the image hashes. Regenerate with `python3 assets/ships/bismarck/reports/visual-iteration-02/make-comparisons.py` after a new ship build.

- [Bridge before/after](bridge-before-after.png)
- [Funnel before/after](funnel-before-after.png)
- [Overall quarter view before/after](quarter-bow-before-after.png)
- [Anton gunhouse before/after](anton-before-after.png)
- [Stern curvature before/after](stern-curvature-before-after.png)
- [Actual in-game close view](../browser/close-exterior.png)

The model grew from **59,194 to 361,184 triangles**; the faired hull grew from **806 to 14,014**. This measures geometry, not reference fidelity. The final 20.39 MiB GLB passed the existing asset limits, all 87 project tests, production build, reference-cache independence rebuild and in-game articulation review. [Validation](../validation.md) records the checks.

The historical fit is still 24 May 1941 at a separately stated standard draft. Remaining differences in hull reconstruction, gallery contours, small fittings and internal boundaries are documented in the [discrepancy register](../discrepancies.md). The [full reference review](../../generated/comparison/index.html) retains the GameModels3D and historical comparisons without independently stretching either source.
