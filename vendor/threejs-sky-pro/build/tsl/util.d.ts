/**
 * Equirectangular projection helpers, unit direction ↔ UV ∈ [0,1]². Right-handed, Y-up.
 * Convention matches three.js `equirectUV()`: +X at u=0.5, +Z at u=0.75, zenith at v=1.
 */
/** UV ∈ [0,1]² → unit direction. */
export declare function equirectDirFromUV(uv: any): any;
/** Unit direction → UV ∈ [0,1]², inverse of `equirectDirFromUV`. `dir` normalized internally. */
export declare function equirectUVFromDir(dir: any): any;
/**
 * Ray–sphere intersection. Returns `vec2(tNear, tFar)` as distances along the ray in the
 * ray's own units; a miss returns `vec2(-1, -1)`. Both roots may be negative when the
 * sphere is entirely behind the origin — test the sign before using them.
 *
 * @param rayOrigin Ray origin, same frame as `center`.
 * @param rayDirection Ray direction. Must be unit length, or `t` is not a distance.
 * @param center Sphere center.
 * @param radius Sphere radius.
 */
export declare const raySphere: any;
