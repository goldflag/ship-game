import { Matrix3 } from 'three/webgpu';

/** Equatorial (J2000) to galactic coordinates: rows are the galactic axes in equatorial coordinates, x toward
 * the galactic centre (RA 266.4°, Dec −28.9°), y toward longitude 90° and z toward the north galactic pole
 * (RA 192.9°, Dec +27.1°), so the galactic plane stands 62.9° to the celestial equator (Hipparcos, ESA 1997). */
const EQUATORIAL_TO_GALACTIC = new Matrix3().set(
  -.0548755604, -.8734370902, -.4838350155,
  .4941094279, -.44482963, .7469822445,
  -.867666149, -.1980763734, .4559837762,
);

/** World → galactic rotation for the sky's star frame (`SkyUniforms.starRotation`, world → celestial). The
 * catalog and the Milky Way are both drawn in this frame, so one matrix places them. */
export function galacticRotation(starRotation: Matrix3, target = new Matrix3()): Matrix3 {
  return target.multiplyMatrices(EQUATORIAL_TO_GALACTIC, starRotation);
}
