import * as u from "three/webgpu";
import { dot as Z, vec2 as z, clamp as ue, float as a, max as D, abs as Ne, smoothstep as ye, mix as ae, uniform as g, uv as ge, normalize as be, vec4 as se, positionGeometry as Wt, atan as ti, PI as xe, asin as si, Fn as le, If as W, sqrt as me, cos as ot, vec3 as j, sin as rt, texture as de, positionWorld as ii, cameraPosition as ai, Loop as ke, length as Oe, exp as re, acos as ni, min as pe, step as lt, cross as Gt, floor as ze, pow as Ds, log2 as oi, Break as Ut, select as he, property as ht, mrt as Ct, output as Nt, texture3D as Ps, screenCoordinate as Os, fract as Ke, pass as _s, bool as Xt, screenUV as Se, viewZToLogarithmicDepth as ri, cameraNear as li, cameraFar as hi, rtt as ui, pmremTexture as ci, logarithmicDepthToViewZ as di, perspectiveDepthToViewZ as pi } from "three/tsl";
import * as M from "three";
const mi = 0.8;
function Rs(n, e, t) {
  const s = n.sub(t.center), i = Z(s, t.axisU).div(t.extent).mul(0.5).add(0.5), o = Z(s, t.axisV).div(t.extent).mul(0.5).add(0.5), r = e.sample(
    z(ue(i, a(0), a(1)), ue(a(1).sub(o), a(0), a(1)))
  ).r, h = D(Ne(i.sub(0.5)), Ne(o.sub(0.5))).mul(2), l = a(1).sub(ye(a(mi), a(1), h)), c = t.intensity.mul(l).mul(t.enabled);
  return ae(a(1), r, c);
}
class Cs {
  /** Unit forward axis (camera −Z), world space. */
  forward = g(new u.Vector3(0, 0, -1));
  /** Right axis scaled by `tan(fov/2) · aspect`, so NDC x = ±1 lands on the frustum edge. */
  right = g(new u.Vector3(1, 0, 0));
  /** Up axis scaled by `tan(fov/2)`. */
  up = g(new u.Vector3(0, 1, 0));
  _axis = new u.Vector3();
  /** Refresh from a camera; call before anything samples a ray this frame. */
  update(e) {
    const t = e.matrixWorld.elements, s = Math.tan(e.fov * Math.PI / 360);
    this.forward.value.set(-t[8], -t[9], -t[10]).normalize(), this._axis.set(t[0], t[1], t[2]).normalize(), this.right.value.copy(this._axis).multiplyScalar(s * e.aspect), this._axis.set(t[4], t[5], t[6]).normalize(), this.up.value.copy(this._axis).multiplyScalar(s);
  }
}
function Ns(n, e, t) {
  return be(
    n.forward.add(n.right.mul(e)).add(n.up.mul(t))
  );
}
function ct(n, e) {
  let t = ge().x.mul(2).sub(1), s = ge().y.mul(2).sub(1);
  return e && (t = t.add(e.x), s = s.add(e.y)), Ns(n, t, s);
}
function kt(n, e) {
  return Ns(
    n,
    e.x.mul(2).sub(1),
    a(1).sub(e.y.mul(2))
  );
}
function gi(n, e, t, s, i) {
  const o = kt(t, n).toVar(), r = i(e).negate(), h = o.dot(t.forward).max(a(1e-4)), l = r.div(h).toVar();
  return { worldPos: s.add(o.mul(l)), viewDir: o, dist: l };
}
function jt() {
  return se(Wt.x, Wt.y, 0, 1);
}
class yi {
  /**
   * Rayleigh (molecular) scattering strength — a multiplier on the sea-level coefficient.
   * 1 = physical Earth; higher deepens the blue sky and reddens a low sun. Default 1.
   */
  rayleigh = g(1);
  /** Aerosol / haze amount. 1 = very clear, 10 = heavy haze. Default 3.3. */
  turbidity = g(3.3);
  /**
   * Mie forward-scattering asymmetry for the Henyey-Greenstein phase function.
   * 0 = isotropic, 0.99 = strongly forward. Default 0.7.
   */
  mieDirectionalG = g(0.7);
  /**
   * Multiplier on the Mie single-scatter term — the sun's forward aureole.
   * 1 = consistent with `turbidity`. Default 1.
   */
  mieScatteringStrength = g(1);
  /**
   * Multi-scatter fill for the sky light reaching the clouds. 0 = single-scatter,
   * 0.2 typical. Default 0.2.
   */
  multipleScattering = g(0.2);
  /**
   * Sky-dome multi-scatter strength. 0 = single-scatter dome, 1 = nominal.
   * Default 0.5.
   */
  skyMultipleScattering = g(0.5);
  /** Tonemap exposure — a scalar multiply on linear radiance. 1 = neutral. Default 1. */
  exposure = g(1);
  /**
   * Lambertian ground albedo (linear RGB) tinting the sky's multiple-scatter bounce and
   * the cloud ground-bounce fill. Roughly (0.12, 0.16, 0.09) for green land, brighter for
   * snow or sand, near-black for water; the whole-Earth land average is about 0.15.
   * Default (0.18, 0.17, 0.15).
   */
  groundAlbedo = g(new M.Color(0.18, 0.17, 0.15));
  /**
   * Distance-fog fade rate. 1 puts the 50%-fogged point near 23 km; 0 disables the fog.
   * Default 1.25.
   */
  fogDensity = g(1.25);
  /**
   * Camera-to-surface distance (world meters) where the far-fade band starts pulling
   * geometry toward sky. The default sits past any practical scene, so the band is off
   * until you lower it. Default 1,000,000.
   */
  fogFarFadeStart = g(1e6);
  /**
   * Camera-to-surface distance (world meters) where geometry is fully sky. Set it above
   * `fogFarFadeStart`; the span between the two is the ramp. Default 1,100,000.
   */
  fogFarFadeEnd = g(11e5);
  /** @param params Initial values; omitted fields keep their default. */
  constructor(e = {}) {
    this.applyParams(e);
  }
  /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
  applyParams(e) {
    e.rayleigh !== void 0 && (this.rayleigh.value = e.rayleigh), e.turbidity !== void 0 && (this.turbidity.value = e.turbidity), e.mieDirectionalG !== void 0 && (this.mieDirectionalG.value = e.mieDirectionalG), e.mieScatteringStrength !== void 0 && (this.mieScatteringStrength.value = e.mieScatteringStrength), e.multipleScattering !== void 0 && (this.multipleScattering.value = e.multipleScattering), e.skyMultipleScattering !== void 0 && (this.skyMultipleScattering.value = e.skyMultipleScattering), e.exposure !== void 0 && (this.exposure.value = e.exposure), e.groundAlbedo !== void 0 && this.groundAlbedo.value.copy(e.groundAlbedo), e.fogDensity !== void 0 && (this.fogDensity.value = e.fogDensity), e.fogFarFadeStart !== void 0 && (this.fogFarFadeStart.value = e.fogFarFadeStart), e.fogFarFadeEnd !== void 0 && (this.fogFarFadeEnd.value = e.fogFarFadeEnd);
  }
  /**
   * Returns a new params object holding every uniform's current value. `groundAlbedo` is
   * cloned, so later writes to this `Atmosphere` don't reach the returned object. Passing
   * the result to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return {
      rayleigh: this.rayleigh.value,
      turbidity: this.turbidity.value,
      mieDirectionalG: this.mieDirectionalG.value,
      mieScatteringStrength: this.mieScatteringStrength.value,
      multipleScattering: this.multipleScattering.value,
      skyMultipleScattering: this.skyMultipleScattering.value,
      exposure: this.exposure.value,
      groundAlbedo: this.groundAlbedo.value.clone(),
      fogDensity: this.fogDensity.value,
      fogFarFadeStart: this.fogFarFadeStart.value,
      fogFarFadeEnd: this.fogFarFadeEnd.value
    };
  }
}
class Si {
  /** World-space direction toward the sun. Unit length. */
  direction = g(new M.Vector3(0, 0.3, -1).normalize());
  /**
   * Sun radiance for the current frame (`peakIntensity` faded by elevation). Written by
   * `SunDriver` — read it, but set `peakIntensity` instead of writing here.
   */
  intensity = g(6.6);
  /** Peak daytime sun radiance, calibrated for exposure 1. Default 6.6. */
  peakIntensity = 6.6;
  /**
   * Sunlight tint at full daylight, linear RGB. Leave it warm white — the atmosphere
   * produces the sunset reddening on its own. Default (1, 0.95, 0.85).
   */
  color = g(new M.Color(1, 0.95, 0.85));
  /**
   * Sun disc angular radius as `1 - cos(θ)`. The default 0.0003 is a 1.4° radius (a 2.8°
   * disc) — roughly 5× the physical sun's 0.53°, oversized for visual presence.
   */
  discSize = g(3e-4);
  /** @param params Initial values; omitted fields keep their default. */
  constructor(e = {}) {
    this.applyParams(e);
  }
  /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
  applyParams(e) {
    (e.elevation !== void 0 || e.azimuth !== void 0) && this.setFromAngles(
      e.elevation ?? this.elevationDeg,
      e.azimuth ?? this.azimuthDeg
    ), e.intensity !== void 0 && (this.peakIntensity = e.intensity), e.color && this.color.value.copy(e.color), e.discSize !== void 0 && (this.discSize.value = e.discSize);
  }
  /**
   * Points `direction` at the given angles, in degrees.
   *
   * @param elevationDeg 0 = horizon, 90 = zenith.
   * @param azimuthDeg 0 = +Z, 90 = +X.
   */
  setFromAngles(e, t) {
    const s = e * Math.PI / 180, i = t * Math.PI / 180, o = Math.cos(s);
    this.direction.value.set(o * Math.sin(i), Math.sin(s), o * Math.cos(i)).normalize();
  }
  /** Compass azimuth of `direction`, in degrees, range (-180, 180]. Inverse of {@link setFromAngles}. */
  get azimuthDeg() {
    return Math.atan2(this.direction.value.x, this.direction.value.z) * 180 / Math.PI;
  }
  /** Altitude of `direction` above the horizon, in degrees, range [-90, 90]. Inverse of {@link setFromAngles}. */
  get elevationDeg() {
    const e = Math.max(-1, Math.min(1, this.direction.value.y));
    return Math.asin(e) * 180 / Math.PI;
  }
  /**
   * Returns a new params object holding the sun's current angles, peak intensity, tint,
   * and disc size. `elevation`/`azimuth` are measured off the current `direction`, and
   * `color` is cloned. Passing the result to {@link applyParams} restores the state it
   * was taken from.
   */
  toParams() {
    return {
      elevation: this.elevationDeg,
      azimuth: this.azimuthDeg,
      intensity: this.peakIntensity,
      color: this.color.value.clone(),
      discSize: this.discSize.value
    };
  }
}
class vi {
  /** Altitude of the cloud base in meters. Default 1400. */
  altitude = g(1400);
  /** Vertical thickness of the shell in meters. Default 2800. */
  thickness = g(2800);
  /** Extinction coefficient per meter; higher reads more opaque. Default 0.048. */
  density = g(0.048);
  /** Coverage. Range [0, 1]: 0 = clear sky, 1 = the weather map as authored. Default 1. */
  coverage = g(1);
  /** Distance from the camera in meters where the horizon coverage lift begins. Default 10,000. */
  horizonCoverageStart = g(1e4);
  /** Distance in meters over which the lift ramps from base coverage to full. Default 20,000. */
  horizonCoverageRamp = g(2e4);
  /**
   * Extra coverage added at full ramp. Above 0 this thickens far clouds into a horizon
   * bank and may exceed 1 to fill gaps. 0 = off. Default 0.
   */
  horizonCoverageAmount = g(0);
  /** Soft-edge half-width at the cloud base, as a shell height fraction. Default 0.05. */
  edgeSoftness = g(0.05);
  /** Per-kilometer division applied to `edgeSoftness` above the base. 1 = constant softness. Default 1. */
  edgeSoftnessFalloff = g(1);
  /** World meters per weather-map tile. Default 40,000. */
  weatherScale = g(4e4);
  /** World meters per base-shape-texture tile. Default 8000. */
  baseScale = g(8e3);
  /** Erosion tile as a fraction of `baseScale`. Range [0, 1], lower = finer. Default 0.5. */
  erosionScaleBaseMultiplier = g(0.5);
  /** Multiplier across all base-shape channels; dilates the top only. 1 = unchanged. Default 1. */
  baseStrength = g(1);
  /** Erosion strength at shell height fraction 0. Carves the top and the base. Default 1. */
  erosionStrengthBase = g(1);
  /** Erosion strength at shell height fraction 1. Default 1. */
  erosionStrengthPeak = g(1);
  /** Erosion shape. 0 = billowy, 1 = wispy. Default 0. */
  erosionShape = g(0);
  /**
   * Weather-map floor-carve strength: the coverage a column needs to keep its base, so
   * thin columns lose their base before thick ones do. 0 = off. Default 0.
   */
  baseWeatherStrength = g(0);
  /** Shell height fraction where the floor-carve requirement is strongest. Default 0.05. */
  baseWeatherHeightStart = g(0.05);
  /** Shell height fraction above which the floor-carve requirement has fully relaxed. Default 0.1. */
  baseWeatherHeightEnd = g(0.1);
  /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
  applyParams(e) {
    e.altitude !== void 0 && (this.altitude.value = e.altitude), e.thickness !== void 0 && (this.thickness.value = e.thickness), e.density !== void 0 && (this.density.value = e.density), e.coverage !== void 0 && (this.coverage.value = e.coverage), e.horizonCoverageStart !== void 0 && (this.horizonCoverageStart.value = Math.max(0, e.horizonCoverageStart)), e.horizonCoverageRamp !== void 0 && (this.horizonCoverageRamp.value = Math.max(0, e.horizonCoverageRamp)), e.horizonCoverageAmount !== void 0 && (this.horizonCoverageAmount.value = Math.max(0, e.horizonCoverageAmount)), e.edgeSoftness !== void 0 && (this.edgeSoftness.value = e.edgeSoftness), e.edgeSoftnessFalloff !== void 0 && (this.edgeSoftnessFalloff.value = e.edgeSoftnessFalloff), e.weatherScale !== void 0 && (this.weatherScale.value = e.weatherScale), e.baseScale !== void 0 && (this.baseScale.value = e.baseScale), e.erosionScaleBaseMultiplier !== void 0 && (this.erosionScaleBaseMultiplier.value = e.erosionScaleBaseMultiplier), e.baseStrength !== void 0 && (this.baseStrength.value = e.baseStrength), e.erosionStrengthBase !== void 0 && (this.erosionStrengthBase.value = e.erosionStrengthBase), e.erosionStrengthPeak !== void 0 && (this.erosionStrengthPeak.value = e.erosionStrengthPeak), e.erosionShape !== void 0 && (this.erosionShape.value = e.erosionShape), e.baseWeatherStrength !== void 0 && (this.baseWeatherStrength.value = e.baseWeatherStrength), e.baseWeatherHeightStart !== void 0 && (this.baseWeatherHeightStart.value = e.baseWeatherHeightStart), e.baseWeatherHeightEnd !== void 0 && (this.baseWeatherHeightEnd.value = e.baseWeatherHeightEnd);
  }
  /**
   * Returns a new params object holding every uniform's current value. Passing the result
   * to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return {
      altitude: this.altitude.value,
      thickness: this.thickness.value,
      density: this.density.value,
      coverage: this.coverage.value,
      horizonCoverageStart: this.horizonCoverageStart.value,
      horizonCoverageRamp: this.horizonCoverageRamp.value,
      horizonCoverageAmount: this.horizonCoverageAmount.value,
      edgeSoftness: this.edgeSoftness.value,
      edgeSoftnessFalloff: this.edgeSoftnessFalloff.value,
      weatherScale: this.weatherScale.value,
      baseScale: this.baseScale.value,
      erosionScaleBaseMultiplier: this.erosionScaleBaseMultiplier.value,
      baseStrength: this.baseStrength.value,
      erosionStrengthBase: this.erosionStrengthBase.value,
      erosionStrengthPeak: this.erosionStrengthPeak.value,
      erosionShape: this.erosionShape.value,
      baseWeatherStrength: this.baseWeatherStrength.value,
      baseWeatherHeightStart: this.baseWeatherHeightStart.value,
      baseWeatherHeightEnd: this.baseWeatherHeightEnd.value
    };
  }
}
class fi {
  /** Single-scattering albedo — scales scattered radiance. Range [0, 1]. Default 0.9. */
  scatteringAlbedo = g(0.9);
  /** Powder dark-edge strength on the direct sun term. Default 1. */
  powderStrength = g(1);
  /** Ground-tinted ambient multiplier. Default 0.6. */
  ambientIntensity = g(0.6);
  /**
   * Albedo of the ground directly under the clouds (linear RGB), tinting the base bounce
   * fill. Set it to art-direct the cloud-base color; `Atmosphere.groundAlbedo` is the
   * separate knob for the sky. Default (0.18, 0.17, 0.15).
   */
  groundBounceAlbedo = g(new M.Color(0.18, 0.17, 0.15));
  /** Cloud-base darkening. Range [0, 1]: 0 = lit bases, 1 = full shading down to the floor. Default 0. */
  baseShadowStrength = g(0);
  /** Shell height fraction over which the base shadow eases back to full light. Bigger = softer. Default 0.6. */
  baseShadowHeight = g(0.6);
  /** Moon-key lighting gain. Default 1. */
  moonGain = g(1);
  /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
  applyParams(e) {
    e.scatteringAlbedo !== void 0 && (this.scatteringAlbedo.value = e.scatteringAlbedo), e.powderStrength !== void 0 && (this.powderStrength.value = e.powderStrength), e.ambientIntensity !== void 0 && (this.ambientIntensity.value = e.ambientIntensity), e.groundBounceAlbedo !== void 0 && this.groundBounceAlbedo.value.copy(e.groundBounceAlbedo), e.baseShadowStrength !== void 0 && (this.baseShadowStrength.value = e.baseShadowStrength), e.baseShadowHeight !== void 0 && (this.baseShadowHeight.value = e.baseShadowHeight), e.moonGain !== void 0 && (this.moonGain.value = e.moonGain);
  }
  /**
   * Returns a new params object holding every uniform's current value. Passing the result
   * to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return {
      scatteringAlbedo: this.scatteringAlbedo.value,
      powderStrength: this.powderStrength.value,
      ambientIntensity: this.ambientIntensity.value,
      groundBounceAlbedo: this.groundBounceAlbedo.value.clone(),
      baseShadowStrength: this.baseShadowStrength.value,
      baseShadowHeight: this.baseShadowHeight.value,
      moonGain: this.moonGain.value
    };
  }
}
class Ai {
  /** Drift heading in degrees. 0 = +Z, 90 = +X. Default 0. */
  heading = 0;
  /** Horizontal drift speed in meters per second. Default 0. */
  speed = 0;
  /** Noise-evolution speed in meters per second, scrolled opposite the drift. Default 0. */
  evolutionSpeed = 0;
  /** Downwind cloud-top lean: meters of horizontal shift from base to top. Default 0. */
  skew = g(0);
  /** Unit horizontal drift direction. Refreshed from `heading` on each `advance`. */
  direction = g(new M.Vector3(0, 0, 1));
  /** Accumulated horizontal world offset in meters. */
  offset = g(new M.Vector3());
  /** Accumulated evolution-scroll distance in meters, applied against `direction`. */
  evolutionOffset = g(0);
  /**
   * Advances the animated offsets. Call once per frame.
   *
   * @param dt Elapsed time in seconds.
   */
  advance(e) {
    const t = this.heading * Math.PI / 180, s = Math.sin(t), i = Math.cos(t);
    this.direction.value.set(s, 0, i), this.offset.value.x += s * this.speed * e, this.offset.value.z += i * this.speed * e, this.evolutionOffset.value += this.evolutionSpeed * e;
  }
  /** Writes each provided field. Omitted fields are left untouched. */
  applyParams(e) {
    e.heading !== void 0 && (this.heading = e.heading), e.speed !== void 0 && (this.speed = e.speed), e.evolutionSpeed !== void 0 && (this.evolutionSpeed = e.evolutionSpeed), e.skew !== void 0 && (this.skew.value = e.skew);
  }
  /**
   * Returns a new params object holding every uniform's current value. The integrated
   * drift offsets are animation state and are excluded, so the result describes the wind,
   * not how far the clouds have travelled. Passing it to {@link applyParams} restores the
   * state it was taken from.
   */
  toParams() {
    return {
      heading: this.heading,
      speed: this.speed,
      evolutionSpeed: this.evolutionSpeed,
      skew: this.skew.value
    };
  }
}
class bi {
  /** World meters per cirrus-texture tile. Larger = bigger streaks. Default 30,000. */
  scale = g(3e4);
  /** Opacity multiplier on the sampled mask. 0 = off. Default 0. */
  strength = g(0);
  /** Writes each provided field onto its uniform, clamping `scale` to at least 1. */
  applyParams(e) {
    e.scale !== void 0 && (this.scale.value = Math.max(1, e.scale)), e.strength !== void 0 && (this.strength.value = e.strength);
  }
  /**
   * Returns a new params object holding every uniform's current value. Passing the result
   * to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return { scale: this.scale.value, strength: this.strength.value };
  }
}
class xi {
  /** World meters per weather-map tile sampled for the haze deck. Default 40,000. */
  scale = g(4e4);
  /** Opacity multiplier on the sampled weather coverage. 0 = off. Default 0. */
  density = g(0);
  /** Writes each provided field onto its uniform, clamping `scale` to at least 1. */
  applyParams(e) {
    e.scale !== void 0 && (this.scale.value = Math.max(1, e.scale)), e.density !== void 0 && (this.density.value = e.density);
  }
  /**
   * Returns a new params object holding every uniform's current value. Passing the result
   * to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return { scale: this.scale.value, density: this.density.value };
  }
}
const Ti = 2e3;
class wi {
  /** Aerial-perspective density multiplier. 1 = physical, higher = hazier, 0 = off. Default 1. */
  hazeDensityScale = g(1);
  /** Hit distance in meters where the far field starts dissolving into sky. Default 25,000. */
  horizonMeltStart = g(25e3);
  /** Hit distance in meters where the dissolve completes. Kept at or above `horizonMeltStart`. Default 40,000. */
  horizonMeltEnd = g(4e4);
  /** View-ray march cap in meters. Not settable directly — raise `horizonMeltEnd` instead. */
  maxMarchDist = this.horizonMeltEnd.add(Ti);
  /** Writes each provided field onto its uniform, then raises `horizonMeltEnd` to `horizonMeltStart` if it fell below. */
  applyParams(e) {
    e.hazeDensityScale !== void 0 && (this.hazeDensityScale.value = Math.max(0, e.hazeDensityScale)), e.horizonMeltStart !== void 0 && (this.horizonMeltStart.value = Math.max(0, e.horizonMeltStart)), e.horizonMeltEnd !== void 0 && (this.horizonMeltEnd.value = Math.max(0, e.horizonMeltEnd)), this.horizonMeltEnd.value = Math.max(
      this.horizonMeltEnd.value,
      this.horizonMeltStart.value
    );
  }
  /**
   * Returns a new params object holding every uniform's current value. `maxMarchDist` is
   * excluded because {@link applyParams} recomputes it from `horizonMeltEnd`. Passing the
   * result to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return {
      hazeDensityScale: this.hazeDensityScale.value,
      horizonMeltStart: this.horizonMeltStart.value,
      horizonMeltEnd: this.horizonMeltEnd.value
    };
  }
}
class Mi {
  /** Shell geometry — altitude, thickness, coverage, and shaping noise. */
  shape = new vi();
  /** Scattering, powder, ambient fill, and the moon key. */
  lighting = new fi();
  /** Drift and noise evolution. Its `advance(dt)` is called for you each frame. */
  wind = new Ai();
  /** High thin-cloud deck. */
  cirrus = new bi();
  /** Storm-haze deck. */
  haze = new xi();
  /** Aerial perspective and the horizon melt. */
  fade = new wi();
  /**
   * Master switch for the cloud layer: the raymarch, the reconstruction, and the ground
   * shadow bake. Set it to `false` to drop clouds from the view and stop paying for them
   * when nothing on screen shows cloud; re-enabling costs a short warm-up. `applyParams`
   * never touches it, so loading a preset cannot turn clouds on or off. Default true.
   */
  enabled = !0;
  /** @param params Initial values; omitted groups keep their defaults. */
  constructor(e = {}) {
    this.applyParams(e);
  }
  /** Applies each provided group to its component. Omitted groups are left untouched. */
  applyParams(e) {
    e.shape && this.shape.applyParams(e.shape), e.lighting && this.lighting.applyParams(e.lighting), e.wind && this.wind.applyParams(e.wind), e.cirrus && this.cirrus.applyParams(e.cirrus), e.haze && this.haze.applyParams(e.haze), e.fade && this.fade.applyParams(e.fade);
  }
  /**
   * Returns a new params object holding all six groups' current values. `enabled` is not
   * included, matching {@link applyParams} never writing it. Passing the result to
   * {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return {
      shape: this.shape.toParams(),
      lighting: this.lighting.toParams(),
      wind: this.wind.toParams(),
      cirrus: this.cirrus.toParams(),
      haze: this.haze.toParams(),
      fade: this.fade.toParams()
    };
  }
}
const Vt = { x: 64, y: 64, z: 64 }, Hi = {
  worleyLow: { cells: [4, 8, 16], weights: [0.625, 0.25, 0.125] },
  worleyMid: { cells: [8, 16, 32], weights: [0.625, 0.25, 0.125] },
  worleyHigh: { cells: [16, 32, 64], weights: [0.625, 0.25, 0.125] }
}, Di = {
  mainMass: { frequency: 5, octaves: 6, seed: 0, amplitude: 3 },
  detail: { frequency: 7, octaves: 6, seed: 1, strength: 0.5 },
  coverage: 0.55
};
class ks {
  /** View-ray march sample cap. Default 128. */
  maxSteps = g(128);
  /**
   * Tap count for the sunward cone that produces the self-shadow. A plain number, read
   * when the shader is built — changing it recompiles. Default 6.
   */
  lightMarchTaps = 6;
  /**
   * Base step of the sunward light march, in meters. Steps grow geometrically by 1.5x,
   * so total reach is about 21x this value. Default 400.
   */
  lightStepSize = g(2e3 / 5);
  /**
   * Tangent of the light-cone half-angle. The sampling disc widens with march distance,
   * softening the self-shadow. 0 = straight march. Default 0.05.
   */
  lightConeSpread = g(0.05);
  /**
   * Accumulated cloud alpha at which light-cone marches stop sampling erosion
   * detail and use base-shape-only density. Range [0, 1]. Default 0.3.
   */
  fullLightingAlpha = g(0.3);
  /** Base view-ray step in meters, and the floor for the distance-based stride. Default 150. */
  baseStepSize = g(150);
  /**
   * Distance-based step growth: the stride is `stepConeFactor × stepConeAngle × distance`,
   * floored at `baseStepSize`. 0 = off. Default 1.
   */
  stepConeFactor = g(1);
  /** Ray-cone angle of the reconstruction grid, written each frame. Not saved in snapshots. */
  stepConeAngle = g(3e-3);
  /**
   * Cap on optical depth per in-cloud step, used to adapt sampling to density. Smaller =
   * finer and slower. Default 0.5.
   */
  maxOpticalDepthPerStep = g(0.5);
  /**
   * Early-exit threshold: the march stops once transmittance falls below this. A plain
   * number, read when the shader is built. Default 0.001.
   */
  earlyExitTransmittance = 1e-3;
  /**
   * Additive level-of-detail bias on the cone-footprint lookup. Raise it to sample
   * coarser mips for a cheaper, blurrier march. Default 0.
   */
  mipBaseLevel = g(0);
  /**
   * Texel count per axis of the bound base-shape volume; the cone footprint's world-texel
   * size is `baseScale / this`. Kept in sync with the bound texture by
   * `SkySystem.setBaseNoiseTextures`.
   */
  baseShapeResolution = g(Vt.x);
  /** Per-pixel ray-cone angle (`2·tan(fov/2)/screenHeight`), written each frame. Not saved in snapshots. */
  pixelConeAngle = g(1e-3);
  /**
   * Ray-start dither: the fraction of the entry step added to the first sample, which
   * breaks march banding into noise. Range [0, 1]. 0 = off. Default 1.
   */
  ditherStrength = g(1);
  /** Per-frame scroll of the dither tile, written each frame. Not saved in snapshots. */
  ditherTemporalPhase = g(0);
  /** @param params Initial values; omitted fields keep their default. */
  constructor(e = {}) {
    this.applyParams(e);
  }
  /**
   * Writes each provided field onto its uniform, clamping to its valid range. Omitted
   * fields are left untouched.
   */
  applyParams(e) {
    e.maxSteps !== void 0 && (this.maxSteps.value = e.maxSteps), e.lightMarchTaps !== void 0 && (this.lightMarchTaps = Math.max(1, Math.round(e.lightMarchTaps))), e.lightStepSize !== void 0 && (this.lightStepSize.value = e.lightStepSize), e.lightConeSpread !== void 0 && (this.lightConeSpread.value = Math.max(0, e.lightConeSpread)), e.fullLightingAlpha !== void 0 && (this.fullLightingAlpha.value = Math.min(1, Math.max(0, e.fullLightingAlpha))), e.baseStepSize !== void 0 && (this.baseStepSize.value = e.baseStepSize), e.stepConeFactor !== void 0 && (this.stepConeFactor.value = Math.max(0, e.stepConeFactor)), e.maxOpticalDepthPerStep !== void 0 && (this.maxOpticalDepthPerStep.value = Math.max(1e-3, e.maxOpticalDepthPerStep)), e.mipBaseLevel !== void 0 && (this.mipBaseLevel.value = e.mipBaseLevel), e.baseShapeResolution !== void 0 && (this.baseShapeResolution.value = e.baseShapeResolution), e.ditherStrength !== void 0 && (this.ditherStrength.value = Math.min(1, Math.max(0, e.ditherStrength)));
  }
  /**
   * Returns a new params object holding every march setting's current value. Passing the
   * result to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return {
      maxSteps: this.maxSteps.value,
      lightMarchTaps: this.lightMarchTaps,
      lightStepSize: this.lightStepSize.value,
      lightConeSpread: this.lightConeSpread.value,
      fullLightingAlpha: this.fullLightingAlpha.value,
      baseStepSize: this.baseStepSize.value,
      stepConeFactor: this.stepConeFactor.value,
      maxOpticalDepthPerStep: this.maxOpticalDepthPerStep.value,
      mipBaseLevel: this.mipBaseLevel.value,
      baseShapeResolution: this.baseShapeResolution.value,
      ditherStrength: this.ditherStrength.value
    };
  }
}
class Pi {
  /** Whether god rays render. Default true. */
  enabled = !0;
  /** Shaft brightness multiplier applied while the moon is the active light. Default 0.4. */
  moonGodRayScale = 0.4;
  /** Master brightness on in-scattered shaft radiance, in linear pre-exposure space. Default 2. */
  strength = g(2);
  /**
   * Contrast (gamma) applied to sun visibility before in-scatter. 1 = raw, above 1 gives
   * crisper shafts. Default 2.
   */
  sharpness = g(2);
  /** Haze extinction in 1/meters. Higher = shorter, denser shafts. Default 0.0002. */
  extinction = g(2e-4);
  /**
   * Far bound of the march in meters, for open-sky pixels; pixels covering geometry stop
   * at the surface. Default 12,500.
   */
  maxDistance = g(12500);
  /** March sample count — the dominant cost knob. Set by the quality level. Default 24. */
  steps = g(24);
  /** @param params Initial values; omitted fields keep their default. */
  constructor(e = {}) {
    this.applyParams(e);
  }
  /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
  applyParams(e) {
    e.enabled !== void 0 && (this.enabled = e.enabled), e.strength !== void 0 && (this.strength.value = e.strength), e.sharpness !== void 0 && (this.sharpness.value = e.sharpness), e.extinction !== void 0 && (this.extinction.value = e.extinction), e.maxDistance !== void 0 && (this.maxDistance.value = e.maxDistance), e.moonGodRayScale !== void 0 && (this.moonGodRayScale = e.moonGodRayScale);
  }
  /**
   * Returns a new params object holding every setting's current value, `steps` excluded.
   * Passing the result to {@link applyParams} restores the state it was taken from.
   */
  toParams() {
    return {
      enabled: this.enabled,
      moonGodRayScale: this.moonGodRayScale,
      strength: this.strength.value,
      sharpness: this.sharpness.value,
      extinction: this.extinction.value,
      maxDistance: this.maxDistance.value
    };
  }
}
class Oi {
  /** Sun clock. 0 = midnight, 0.5 = noon. Default 0.5. Write it directly to jump to a time. */
  time = g(0.5);
  /** Real seconds per simulated day. 0 = paused. Default 600. */
  autoAdvanceSecondsPerDay = 600;
  /**
   * Observer latitude in degrees, range [-90, 90]. Places the celestial pole this many
   * degrees above the northern horizon, tilting the sun and moon arcs and the star
   * rotation axis. 0 = equator (sun passes through the zenith), 90 = north pole.
   * Default 45.
   */
  latitude = 45;
  /**
   * Compass rotation of the whole celestial sphere — sun path, moon, and stars together —
   * about +Y, in degrees. Same convention as `Sun.setFromAngles`: 0 has the sun culminate
   * toward -Z, 90 rotates the sky toward +X. Default 0.
   */
  azimuth = 0;
  /** World-space unit vector toward the moon. Written by `SunDriver` from `time` and `moonPhase`. */
  moonDirection = g(new M.Vector3(0, 0.6, -0.8).normalize());
  /** Moon phase. 0 = new (dark), 0.5 = full, 1 = new again. Default 0.5. */
  moonPhase = g(0.5);
  /** Master moon brightness over disc, sky lift, and cloud key. Default 1. */
  moonIntensity = g(1);
  /**
   * Disc-only brightness, stacking on `moonIntensity`. The default 9 keeps the disc
   * visible through the tonemap at exposure 1.
   */
  moonDiscBrightness = g(9);
  /**
   * Moon angular radius expressed as `1 - cos(theta)`. The default 0.0003 is a
   * 1.4-degree radius (a 2.8-degree disc), about 5x the physical moon and matching
   * `Sun.discSize`.
   */
  moonAngularSize = g(3e-4);
  /** Tint shared by disc, ambient, and cloud key. Linear RGB. Default (0.7, 0.78, 0.95) — cool blue-white. */
  moonColor = g(new M.Color(0.7, 0.78, 0.95));
  /** Scale on the night-sky ambient lift. 0 = pitch-black sky. Default 0.015. */
  moonAmbient = g(0.015);
  // ── Driven uniforms (written by SunDriver each frame; user never writes them) ──
  /** 0 = full day, 1 = full night, crossfading across the twilight band at ±6 degrees of sun elevation. */
  skyDarkness = g(0);
  /**
   * World-to-panorama rotation for the star panorama. Undoes the celestial-sphere
   * placement — diurnal spin about the pole, pole tilt from `latitude`, then `azimuth` —
   * so a view direction can sample the equatorial-frame texture.
   */
  starRotation = g(new M.Matrix3());
  /** Lit fraction of the moon disc, `1 - |2·moonPhase - 1|`, floored. Scales the earthshine terms. */
  moonPhaseIllumination = g(1);
  /** `(cos(psi), sin(psi))` for `psi = (moonPhase - 0.5)·2π`. The default matches a full moon. */
  moonPhaseTrig = g(new M.Vector2(1, 0));
  /** @param params Initial values; omitted fields keep their default. */
  constructor(e = {}) {
    this.applyParams(e);
  }
  /**
   * Writes each provided field onto its uniform, wrapping `time` and clamping `latitude`.
   * Omitted fields are left untouched.
   */
  applyParams(e) {
    e.time !== void 0 && (this.time.value = _i(e.time)), e.autoAdvanceSecondsPerDay !== void 0 && (this.autoAdvanceSecondsPerDay = e.autoAdvanceSecondsPerDay), e.latitude !== void 0 && (this.latitude = Math.max(-90, Math.min(90, e.latitude))), e.azimuth !== void 0 && (this.azimuth = e.azimuth);
    const t = e.moon;
    t && (t.phase !== void 0 && (this.moonPhase.value = t.phase), t.intensity !== void 0 && (this.moonIntensity.value = t.intensity), t.discBrightness !== void 0 && (this.moonDiscBrightness.value = t.discBrightness), t.angularSize !== void 0 && (this.moonAngularSize.value = t.angularSize), t.color && this.moonColor.value.copy(t.color), t.ambient !== void 0 && (this.moonAmbient.value = t.ambient));
  }
  /**
   * Returns a new params object holding the clock, the arc placement, and the moon's
   * current values. `moon.color` is cloned. Passing the result to {@link applyParams}
   * restores the state it was taken from.
   */
  toParams() {
    return {
      time: this.time.value,
      autoAdvanceSecondsPerDay: this.autoAdvanceSecondsPerDay,
      latitude: this.latitude,
      azimuth: this.azimuth,
      moon: {
        phase: this.moonPhase.value,
        intensity: this.moonIntensity.value,
        angularSize: this.moonAngularSize.value,
        color: this.moonColor.value.clone(),
        ambient: this.moonAmbient.value,
        discBrightness: this.moonDiscBrightness.value
      }
    };
  }
}
function _i(n) {
  const e = n - Math.floor(n);
  return e < 0 ? e + 1 : e;
}
const Yt = Math.PI / 180;
class Ri {
  _timeOfDay;
  _sun;
  // Last inputs written to sun.direction; skipping unchanged writes preserves manual drags.
  _lastTime = NaN;
  _lastLatitude = NaN;
  _lastAzimuth = NaN;
  // Scratch matrices for the star-panorama rotation (avoids per-frame allocation).
  _panoramaToWorld = new M.Matrix4();
  _poleTilt = new M.Matrix4();
  _diurnalSpin = new M.Matrix4();
  /** @param config The clock to read and the sun state to write. */
  constructor(e) {
    this._timeOfDay = e.timeOfDay, this._sun = e.sun, e.peakSunIntensity !== void 0 && (this._sun.peakIntensity = e.peakSunIntensity);
  }
  /**
   * Per-frame tick. Advances `time`, then recomputes sun and moon direction, sun
   * intensity, and the star-panorama rotation.
   * @param dt Seconds since the last tick.
   */
  update(e) {
    const t = this._timeOfDay;
    if (t.autoAdvanceSecondsPerDay > 0) {
      const O = e / t.autoAdvanceSecondsPerDay;
      let k = t.time.value + O;
      k -= Math.floor(k), t.time.value = k;
    }
    const s = t.latitude * Yt, i = t.azimuth * Yt, o = (t.time.value - 0.5) * Math.PI * 2, r = Math.cos(s), h = Math.sin(s), l = Math.cos(o), d = -Math.sin(o), y = r * l, p = -h * l, m = Math.cos(i), S = Math.sin(i), A = d * m + p * S, H = y, P = -d * S + p * m, v = t.time.value !== this._lastTime || t.latitude !== this._lastLatitude || t.azimuth !== this._lastAzimuth;
    this._lastTime = t.time.value, this._lastLatitude = t.latitude, this._lastAzimuth = t.azimuth, v && (this._sun.direction.value.set(A, H, P).normalize(), this._panoramaToWorld.makeRotationY(i).multiply(this._poleTilt.makeRotationX(Math.PI / 2 - s)).multiply(
      this._diurnalSpin.makeRotationY(t.time.value * Math.PI * 2)
    ), t.starRotation.value.setFromMatrix4(this._panoramaToWorld).transpose());
    const x = Math.asin(
      Math.max(-1, Math.min(1, this._sun.direction.value.y))
    ), T = -6 * Math.PI / 180, _ = 6 * Math.PI / 180, R = Ci(
      (x - T) / (_ - T)
    ), b = R * R * (3 - 2 * R);
    this._sun.intensity.value = this._sun.peakIntensity * b, t.skyDarkness.value = 1 - b, t.moonDirection.value.set(-A, -H, -P).normalize();
    const f = 1 - Math.abs(2 * t.moonPhase.value - 1);
    t.moonPhaseIllumination.value = Math.max(0.05, f);
    const w = (t.moonPhase.value - 0.5) * Math.PI * 2;
    t.moonPhaseTrig.value.set(
      Math.cos(w),
      Math.sin(w)
    );
  }
}
function Ci(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function yt(n) {
  const e = n.x.sub(a(0.5)).mul(a(2).mul(xe)), t = n.y.sub(a(0.5)).mul(xe), s = ot(t);
  return j(s.mul(ot(e)), rt(t), s.mul(rt(e)));
}
function Ni(n) {
  const e = be(n), t = ti(e.z, e.x).div(a(2).mul(xe)).add(a(0.5)), s = si(ue(e.y, a(-1), a(1))).div(xe).add(a(0.5));
  return z(t, s);
}
const Ee = le(([n, e, t, s]) => {
  const i = n.sub(t), o = Z(i, e), r = Z(i, i).sub(s.mul(s)), h = o.mul(o).sub(r), l = z(-1, -1).toVar();
  return W(h.greaterThanEqual(0), () => {
    const c = me(h);
    l.assign(
      z(o.negate().sub(c), o.negate().add(c))
    );
  }), l;
}), dt = {
  /** Sky dome / HDRI. Opaque list — draws first, before scene opaques z-test over it. */
  background: { list: "opaque", order: -90 },
  /** Blended backdrop (stars, cirrus). Behind all scene content; writes no depth. */
  backgroundOverlay: { list: "transparent", order: -50 },
  /** A depth-writing surface under the sky (water). Overlays depth-test against it. */
  worldSurface: { list: "opaque", order: -30 },
  /** Depth-tested overlay (clouds). Draws after `worldSurface`, over the scene. */
  atmosphereOverlay: { list: "transparent", order: -20 },
  /** Your own transparent scene objects — glass, particles. three's default slot. */
  sceneTransparent: { list: "transparent", order: 0 },
  /** Always-on-top overlays — HUD sprites, gizmos. */
  foreground: { list: "transparent", order: 100 }
};
function pt(n, e, t = 0) {
  n.renderOrder = e.order + t, ki(n, e);
}
function ki(n, e) {
  const t = n.material;
  if (!t || Array.isArray(t)) return;
  const s = t.transparent === !0, i = e.list === "transparent";
  s !== i && console.warn(
    `[sky-pro] ${n.name || "object"} was placed in a "${e.list}" layer but its material.transparent is ${s}. It will draw in the ${s ? "transparent" : "opaque"} list instead, ignoring the layer's order.`
  );
}
const ji = "data:image/jpeg;base64,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", Vi = ji;
async function Kt(n, e) {
  return typeof n != "string" ? { texture: n, owned: !1 } : { texture: await e.loadAsync(n), owned: !0 };
}
class zt {
  /** The background sphere. Added to and removed from the scene by `SkySystem`. */
  mesh;
  /** Brightness multiplier on the sampled texture, calibrated for exposure 1. Default 0.3. */
  intensity = g(0.3);
  /** Lunar surface map — the bundled one unless `moonTexture` overrode it. @internal */
  moonTexture;
  _material;
  _timeOfDay;
  // Shared by every material built from `colorNodeForDirection`; `setTexture` swaps its value.
  _textureNode;
  _texture;
  _textureRevision = 0;
  _ownsTexture;
  _ownsMoonTexture;
  /**
   * Load the star panorama and the lunar map, then build the panorama. Anything given as a
   * URL is loaded here and released by {@link dispose}; a `THREE.Texture` passed in stays
   * the caller's to dispose.
   * @internal
   */
  static async load(e, t) {
    const s = new u.TextureLoader(), [i, o] = await Promise.all([
      Kt(e.texture, s),
      Kt(e.moonTexture ?? Vi, s)
    ]);
    return new zt(i, o, t, e);
  }
  constructor(e, t, s, i = {}) {
    this._texture = e.texture, this._ownsTexture = e.owned, this.moonTexture = t.texture, this._ownsMoonTexture = t.owned, this._timeOfDay = s, this._configureTexture(this._texture), this._textureNode = de(this._texture), i.intensity !== void 0 && (this.intensity.value = i.intensity);
    const o = i.radius ?? 9e4, r = new u.SphereGeometry(o, 32, 16);
    this._material = new u.MeshBasicNodeMaterial(), this._material.side = u.BackSide, this._material.depthWrite = !1, this._material.fog = !1, this._material.depthTest = !0, this._material.transparent = !0, this._material.blending = u.AdditiveBlending, this._material.depthNode = a(1), this._material.colorNode = this._buildColorNode(), this.mesh = new u.Mesh(r, this._material), this.mesh.frustumCulled = !1, pt(this.mesh, dt.backgroundOverlay);
  }
  /** Per-frame visibility cull — hides the mesh in full daylight. */
  updateVisibility() {
    this.mesh.visible = this._timeOfDay.skyDarkness.value > 0.01;
  }
  /**
   * Swap the star panorama. The outgoing texture is disposed only if this instance owned it.
   * @param ownsNewTexture True to hand ownership of `panoramaTexture` over for disposal.
   */
  setTexture(e, t = !1) {
    if (this._texture === e) {
      this._ownsTexture = t;
      return;
    }
    this._ownsTexture && this._texture !== e && this._texture.dispose(), this._texture = e, this._ownsTexture = t, this._configureTexture(e), this._textureNode.value = e, this._textureRevision++;
  }
  /** Monotonic revision for environment bakes that consume the panorama. @internal */
  get textureRevision() {
    return this._textureRevision;
  }
  /** Current Three.js upload version of the bound panorama texture. @internal */
  get textureVersion() {
    return this._texture.version;
  }
  /** Release the sphere, its material, and any texture this instance loaded. */
  dispose() {
    this._ownsTexture && this._texture.dispose(), this._ownsMoonTexture && this.moonTexture.dispose(), this.mesh.geometry.dispose(), this._material.dispose();
  }
  /** Equirect sampling setup: wrap in longitude, clamp at the poles, mip down. */
  _configureTexture(e) {
    e.mapping = u.UVMapping, e.colorSpace = u.SRGBColorSpace, e.wrapS = u.RepeatWrapping, e.wrapT = u.ClampToEdgeWrapping, e.minFilter = u.LinearMipmapLinearFilter, e.magFilter = u.LinearFilter, e.generateMipmaps = !0, e.needsUpdate = !0;
  }
  /**
   * Lit star color (linear RGB, TSL vec3) for a world-space direction node. Shared by the
   * background sphere and the env-map bake.
   * @param direction Unit world-space direction node to sample along.
   * @internal
   */
  colorNodeForDirection(e) {
    const t = this._timeOfDay.skyDarkness, s = this._timeOfDay.starRotation, i = this.intensity, o = s.mul(e), r = Ni(o), l = this._textureNode.sample(r).rgb.mul(i).mul(t);
    return D(l, j(0, 0, 0));
  }
  _buildColorNode() {
    return le(() => {
      const e = be(ii.sub(ai));
      return se(this.colorNodeForDirection(e), a(1));
    })();
  }
}
const ie = {
  /** Mean Earth radius. Kilometers. */
  EARTH_R_KM: 6371,
  /** Top-of-atmosphere shell radius — Earth radius + 100 km. Kilometers. */
  ATMO_R_KM: 6471,
  /** Atmosphere shell thickness (`ATMO_R_KM - EARTH_R_KM`). Kilometers. */
  ATMOSPHERE_THICKNESS_KM: 100,
  /** Rayleigh density scale height. Kilometers. */
  RAYLEIGH_SCALE_HEIGHT_KM: 8,
  /** Mie density scale height. Kilometers. */
  MIE_SCALE_HEIGHT_KM: 1.2,
  /** Rayleigh sea-level scattering coefficients, per R/G/B channel. km⁻¹. */
  RAYLEIGH_BETA_RGB_KM: [5802e-6, 0.013558, 0.0331],
  /** Mie base scattering magnitude, scaled by turbidity at each use site. km⁻¹. */
  MIE_BETA_BASE_KM: 0.021,
  /** Mie extinction ÷ scattering ratio (single-scattering albedo ≈ 0.9 → ×1.1). */
  MIE_EXTINCTION_FACTOR: 1.1
}, qt = a(ie.EARTH_R_KM), Qt = a(ie.ATMO_R_KM), Zt = a(ie.RAYLEIGH_SCALE_HEIGHT_KM), Jt = a(ie.MIE_SCALE_HEIGHT_KM), zi = ie.ATMOSPHERE_THICKNESS_KM, Ei = j(...ie.RAYLEIGH_BETA_RGB_KM), St = a(ie.MIE_BETA_BASE_KM), $t = a(ie.MIE_EXTINCTION_FACTOR);
function Li(n, e) {
  const t = be(
    j(n.x, D(n.y, a(1e-3)), n.z)
  ), s = z(t.x, t.z), i = z(e.x, e.z), o = D(
    Oe(s).mul(Oe(i)),
    a(1e-6)
  ), r = ue(
    Z(s, i).div(o),
    a(-1),
    a(1)
  ), h = ni(r);
  return z(
    me(h.div(xe)),
    me(ue(t.y, a(0), a(1)))
  );
}
function Et(n, e, t) {
  return de(n, Li(e, t)).level(a(0)).rgb;
}
const es = 12;
function js(n, e, t, s, i, o, r, h) {
  const l = Ei.mul(o), c = qt.add(1e-4), d = j(a(0), c, a(0)), y = be(
    j(t.x, D(t.y, a(1e-3)), t.z)
  ), p = be(s), m = a(2).mul(c).mul(y.y), S = c.mul(c).sub(Qt.mul(Qt)), A = m.negate().add(me(D(m.mul(m).sub(a(4).mul(S)), a(0)))).div(2), H = r ? pe(A, r) : A, P = a(es), v = a(2).mul(H).div(P), x = j(0, 0, 0).toVar(), T = j(0, 0, 0).toVar(), _ = j(0, 0, 0).toVar(), R = a(0).toVar(), b = a(0).toVar(), f = j(St, St, St).mul(i), w = Z(d, p).toVar(), O = Z(y, p).toVar();
  ke(es, ({ i: C }) => {
    const N = a(C).add(0.5).div(P), V = N.mul(N).mul(H), U = N.mul(v), L = d.add(y.mul(V)), Y = Oe(L).toVar(), I = D(Y.sub(qt), a(0)), E = h ? re(I.negate().div(Zt)).mul(h) : re(I.negate().div(Zt)), F = h ? re(I.negate().div(Jt)).mul(h) : re(I.negate().div(Jt));
    R.addAssign(E.mul(U)), b.addAssign(F.mul(U));
    const K = w.add(O.mul(V)).div(Y), ee = z(
      K.mul(a(0.5)).add(a(0.5)),
      I.div(a(zi))
    ), Q = de(n, ee).rgb, te = l.mul(R).add(f.mul($t).mul(b)), q = re(te.negate()), G = q.mul(Q);
    x.addAssign(G.mul(E).mul(U)), T.addAssign(G.mul(F).mul(U));
    const B = de(e, ee).rgb, J = l.mul(E).add(f.mul(F));
    _.addAssign(q.mul(B).mul(J).mul(U));
  });
  const k = l.mul(R).add(f.mul($t).mul(b));
  return { accumR: x, accumM: T, accumMS: _, betaR: l, betaM: f, tauView: k, vDir: y, sunDirN: p };
}
function Vs(n, e, t, s, i, o, r, h, l) {
  const c = o.mul(o), d = a(3).div(a(16).mul(xe)).mul(a(1).add(c)), y = r, p = y.mul(y), m = D(
    a(1).add(p).sub(a(2).mul(y).mul(o)),
    a(1e-3)
  ), S = a(3).mul(a(1).sub(p)).div(a(8).mul(xe).mul(a(2).add(p))).mul(a(1).add(c)).div(m.mul(me(m)));
  return s.mul(n).mul(d).add(i.mul(e).mul(S).mul(l)).add(t.mul(h));
}
function qe(n, e) {
  return le(
    ([t, s, i, o, r, h, l]) => {
      const c = js(
        n,
        e,
        t,
        s,
        i,
        l,
        null,
        null
      );
      return Vs(
        c.accumR,
        c.accumM,
        c.accumMS,
        c.betaR,
        c.betaM,
        Z(c.vDir, c.sunDirN),
        o,
        r,
        h
      );
    }
  );
}
function zs(n, e) {
  return (t) => {
    const s = js(
      n,
      e,
      t.viewDir,
      t.sunDir,
      t.turbidity,
      t.rayleigh,
      t.maxDist,
      t.densityScale
    );
    return {
      inscatter: Vs(
        s.accumR,
        s.accumM,
        s.accumMS,
        s.betaR,
        s.betaM,
        Z(s.vDir, s.sunDirN),
        t.mieG,
        t.skyMultipleScattering,
        t.mieScatteringStrength
      ),
      transmittance: re(s.tauView.negate())
    };
  };
}
class Es extends u.MeshBasicNodeMaterial {
  /** Shared atmospheric scattering state. */
  atmosphere;
  /** Shared sun state: direction, intensity, disc size. */
  sun;
  /** 2D sun-transmittance LUT, indexed by (sun zenith cosine, altitude). */
  transmittanceLUT;
  /** 2D multiple-scattering LUT, sharing the transmittance LUT's (μ, altitude) frame. */
  multiScatterLUT;
  /** Shared angular sky radiance, or null to compile the reference integrator. */
  skyViewLUT;
  /** Time-of-day state, or `null` to compile the moon out. */
  timeOfDay;
  /** Lunar albedo map sampled across the moon disc, or `null` for a flat tinted disc. */
  moonTexture;
  /** Per-fragment view direction node. World space, normalized. */
  viewDirOverride;
  /**
   * @param atmosphere Shared atmospheric scattering state.
   * @param sun Shared sun state.
   * @param transmittanceLUT 2D sun-transmittance LUT.
   * @param multiScatterLUT 2D multiple-scattering LUT.
   * @param skyViewLUT Shared angular sky-radiance LUT, or null for reference integration.
   * @param viewDirOverride Per-fragment view direction node. World space, normalized.
   * @param timeOfDay Time-of-day state, or `null` for no moon.
   * @param moonTexture Lunar albedo map, or `null` for a flat tinted disc.
   */
  constructor(e, t, s, i, o, r, h = null, l = null) {
    super(), this.atmosphere = e, this.sun = t, this.transmittanceLUT = s, this.multiScatterLUT = i, this.skyViewLUT = o, this.timeOfDay = h, this.moonTexture = l, this.viewDirOverride = r, this.depthWrite = !1, this.fog = !1, this.vertexNode = jt(), this.depthNode = a(1), this.colorNode = this._buildColorNode();
  }
  _buildColorNode() {
    const e = this.sun.direction, t = this.atmosphere.rayleigh, s = this.atmosphere.turbidity, i = this.atmosphere.mieDirectionalG, o = this.atmosphere.mieScatteringStrength, r = this.atmosphere.skyMultipleScattering, h = this.sun.intensity, l = this.sun.discSize, c = this.transmittanceLUT, d = this.skyViewLUT, y = d ? null : qe(
      this.transmittanceLUT,
      this.multiScatterLUT
    );
    return le(() => {
      const p = this.viewDirOverride, m = e, A = (d ? Et(d, p, m) : y(
        p,
        m,
        s,
        i,
        r,
        o,
        t
      )).mul(h), H = l, P = Z(p, m), v = ye(
        a(1).sub(H),
        a(1).sub(H.mul(a(0.5))),
        P
      ), x = de(
        c,
        z(m.y.mul(a(0.5)).add(a(0.5)), a(0))
      ).rgb, T = j(1, 0.95, 0.85).mul(x).mul(h).mul(v);
      let _ = j(0, 0, 0);
      if (this.timeOfDay) {
        const b = this.timeOfDay, f = b.moonDirection, w = b.moonPhaseTrig, O = b.moonIntensity, k = b.moonDiscBrightness, C = b.moonAngularSize, N = b.moonColor, V = b.moonAmbient, U = b.moonPhaseIllumination, L = lt(a(0), f.y), Y = N.mul(O).mul(V).mul(U).mul(L), I = j(0, 0.99999999, 1e-4), E = be(f), F = be(Gt(I, E)), K = Gt(E, F), ee = Z(p, F), Q = Z(p, K), te = Z(p, E), q = ye(
          a(1).sub(C),
          a(1).sub(C.mul(0.9)),
          te
        ).mul(L), G = me(
          D(
            a(1).sub(
              a(1).sub(C).mul(a(1).sub(C))
            ),
            a(1e-6)
          )
        ), B = ee.div(G), J = Q.div(G), $ = z(B, J).mul(0.5).add(z(0.5, 0.5)), ne = this.moonTexture ? de(this.moonTexture, $).rgb : j(1, 1, 1), ce = w.x, oe = w.y, fe = E.mul(ce.negate()).add(F.mul(oe)), ve = B.mul(B).add(J.mul(J)), We = be(
          F.mul(B).add(K.mul(J)).sub(E.mul(me(D(a(1).sub(ve), a(0)))))
        ), Ge = D(Z(We, fe), a(0)), mt = ne.mul(N).mul(Ge).mul(k).mul(O).mul(U).mul(q);
        _ = Y.add(mt);
      }
      const R = A.add(T).add(_);
      return se(R, a(1));
    })();
  }
}
class X {
  /** NDC ortho camera shared by every fullscreen pass. */
  static camera = new u.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  static _geometry = null;
  /** Lazily-allocated singleton plane geometry. */
  static geometry() {
    return X._geometry || (X._geometry = new u.PlaneGeometry(2, 2)), X._geometry;
  }
  /** Wrap a material in a fresh scene + mesh ready for `renderer.render`. */
  static makeScene(e) {
    const t = new u.Mesh(X.geometry(), e), s = new u.Scene();
    return s.add(t), { scene: s, mesh: t };
  }
}
class Ii {
  /** The sky material. Its uniforms track the `Atmosphere` and `Sun` passed in. */
  material;
  /** Backdrop mesh. Add it to your scene. */
  mesh;
  /** The sun state this pass renders. */
  sun;
  /** Camera axes every view ray is built from. Written each frame. */
  rayBasis = new Cs();
  /** User-camera world position. Written each frame by `SkyRenderPipeline.updateFrame`. */
  cameraPositionUniform = g(new u.Vector3());
  /**
   * @param atmosphere atmosphere state driving the scattering march.
   * @param sun sun state; also the target of {@link setSunPosition}.
   */
  constructor(e, t, s) {
    this.sun = t, this.material = new Es(
      e,
      t,
      s.transmittanceLUT,
      s.multiScatterLUT,
      s.skyViewLUT,
      ct(this.rayBasis),
      s.timeOfDay ?? null,
      s.moonTexture ?? null
    ), this.mesh = new u.Mesh(X.geometry(), this.material), pt(this.mesh, dt.background), this.mesh.frustumCulled = !1;
  }
  /**
   * Set sun direction from azimuth (radians, 0 = +Z) and elevation (radians, 0 = horizon).
   *
   * @param azimuth radians, 0 = +Z.
   * @param elevation radians, 0 = horizon.
   */
  setSunPosition(e, t) {
    this.sun.setFromAngles(t * 180 / Math.PI, e * 180 / Math.PI);
  }
  dispose() {
    this.material.dispose();
  }
}
const Bi = 0.8, Fi = -0.2, Wi = 0.5, ts = 0.5, Gi = 0.5, Ui = 0.5, Ht = le(([n, e]) => {
  const t = e.mul(e), s = a(1).add(t).sub(e.mul(2).mul(n));
  return a(1).sub(t).div(a(4).mul(xe).mul(s.mul(me(s))));
}), Xi = le(
  ([n, e, t, s]) => ae(
    Ht(n, e),
    Ht(n, t),
    s
  )
), Yi = le(
  ([n, e]) => ae(a(1), a(1).sub(re(n.negate().mul(2))), e)
);
function Ki(n) {
  const {
    position: e,
    extinction: t,
    octavePhases: s,
    msScatter: i,
    originStepLength: o,
    packedOffsets: r,
    densityAt: h,
    originDensity: l
  } = n, c = l.mul(o).toVar();
  for (const A of r) {
    const H = e.add(A.xyz);
    c.addAssign(h(H).mul(A.w));
  }
  const d = c.mul(t).toVar(), y = re(
    d.mul(ts * ts).negate()
  ).toVar(), p = y.mul(y).toVar(), m = p.mul(p).toVar(), S = i.mul(i).toVar();
  return m.mul(s[0]).add(p.mul(i).mul(s[1])).add(y.mul(S).mul(s[2]));
}
const qi = 0.35, Qi = le((n) => {
  const { heightFraction: e, zenithRadiance: t, horizonRadiance: s, groundBounceRadiance: i, ambientIntensity: o } = n, r = ae(t, s, qi), h = ae(r, t, me(e)), l = i.mul(a(1).sub(e));
  return h.add(l).mul(o);
}), Zi = 0.05, Ji = 0.5;
function Dt(n, e, t) {
  const s = Array.from({ length: t }, () => a(0).toVar());
  return W(e, () => {
    let i = a(1);
    for (let o = 0; o < t; o++)
      s[o].assign(
        Xi(
          n,
          i.mul(Bi),
          i.mul(Fi),
          Wi
        )
      ), o < t - 1 && (i = i.mul(Ui));
  }), s;
}
function Ls(n) {
  const t = (n.enabled ?? a(1).greaterThan(0.5)).and(n.sun.intensity.greaterThan(a(1e-4)));
  return {
    sunTint: n.ambientSky.sunTransmittance.toVar(),
    phaseSun: Dt(Z(n.rayDir, n.sun.direction), t, 1)[0],
    zenithRadiance: n.ambientSky.zenithRadiance.toVar()
  };
}
function $i(n) {
  const {
    rayDir: e,
    sun: t,
    cloud: s,
    timeOfDay: i,
    ambientSky: o,
    sunConeOffsets: r,
    moonConeOffsets: h
  } = n, l = t.direction, c = t.intensity, d = s.lighting, y = o.sunTransmittance.toVar(), p = n.enabled ?? a(1).greaterThan(0.5), m = p.and(c.greaterThan(a(1e-4))), S = Dt(Z(e, l), m, 3), A = o.zenithRadiance.toVar(), H = o.horizonRadiance.toVar(), P = o.groundBounceRadiance.toVar(), v = i ? ye(
    a(Zi),
    a(Ji),
    c
  ).oneMinus().toVar() : null, x = i && v ? p.and(i.moonDirection.y.greaterThan(a(0))).and(v.greaterThan(a(0))) : null, T = i && v && x && h ? {
    dir: i.moonDirection,
    color: i.moonColor,
    intensity: i.moonIntensity,
    gain: d.moonGain,
    illum: i.moonPhaseIllumination,
    moonSunFade: v,
    coneOffsets: h
  } : null, _ = T ? Dt(Z(e, T.dir), x, 3) : null;
  return {
    sunTint: y,
    octavePhasesSun: S,
    zenithRadiance: A,
    horizonRadiance: H,
    groundBounceRadiance: P,
    moonNodes: T,
    octavePhasesMoon: _,
    sunConeOffsets: r
  };
}
const ea = 7e3, ta = 0.12, sa = 0.35, ia = 1.2, aa = 1, na = 0.35;
function Is(n) {
  const {
    rayOrigin: e,
    rayDir: t,
    planetCenter: s,
    planetRadius: i,
    cirrusTexture: o,
    scale: r,
    strength: h,
    weatherTexture: l,
    hazeScale: c,
    hazeDensity: d,
    horizonMeltStart: y,
    horizonMeltEnd: p,
    windOffset: m,
    animatedClouds: S,
    sunColor: A,
    sunIntensity: H,
    sunTint: P,
    phaseSun: v,
    zenithRadiance: x
  } = n, T = i.add(a(ea)), _ = Ee(e, t, s, T), R = D(_.y, a(0)), b = e.add(t.mul(R)), f = S ? b.xz.sub(m.xz) : b.xz, w = f.div(D(r, a(1))), O = de(o, w).r, k = f.div(D(c, a(1))), C = l ? de(l, k).r : a(0), N = O.mul(h), V = C.mul(d), U = N.add(V), L = a(1).sub(re(U.negate())), Y = ye(a(0), a(ta), t.y), I = D(p, y.add(a(1))), E = ye(y, I, R).oneMinus(), F = L.mul(Y).mul(E), K = A.mul(P).mul(H).mul(a(sa).add(v.mul(a(ia)))), ee = x.mul(a(aa)), Q = K.add(ee), te = re(V.negate()), q = x.mul(a(na)), G = ae(q, Q, te), B = Q.mul(N).add(G.mul(V)).div(D(U, a(1e-4)));
  return se(B, F);
}
const it = 32, at = 18, je = 32, Bs = it * je;
function ss(n, e, t, s) {
  const i = z(
    ue(e.x.mul(it).sub(0.5), 0, it - 1),
    ue(e.y.mul(at).sub(0.5), 0, at - 1)
  ), o = D(s, a(1)), r = me(ue(t.div(o), 0, 1)), h = ue(
    r.mul(je).sub(0.5),
    0,
    je - 1
  ), l = ze(h), c = pe(l.add(1), a(je - 1)), d = h.sub(l), y = (S) => z(
    S.mul(it).add(i.x).add(0.5).div(Bs),
    i.y.add(0.5).div(at)
  ), p = de(n, y(l)).level(a(0)), m = de(n, y(c)).level(a(0));
  return ae(p, m, d);
}
function oa(n, e, t, s, i) {
  return {
    inscatter: ss(
      n,
      t,
      s,
      i
    ).rgb,
    transmittance: ss(
      e,
      t,
      s,
      i
    ).rgb
  };
}
const ra = ["r", "g", "b", "a"], la = 0.1;
function Je(n, e, t, s) {
  const i = e.div(t);
  return D(a(0), oi(n.div(i)).add(s));
}
function is(n, e, t) {
  let s = a(0);
  for (let i = 0; i < e.length; i++) {
    const o = n[ra[i]].mul(e[i]);
    s = t ? s.add(o) : s.sub(o);
  }
  return s;
}
function Lt(n, e) {
  const {
    position: t,
    shellHeightFraction: s,
    weather: i,
    coverage: o,
    base: r,
    animatedClouds: h,
    windOffset: l,
    windDirection: c,
    windSkew: d,
    evolutionOffset: y,
    weatherScale: p,
    baseScale: m,
    erosionScale: S,
    baseChannelStrengths: A,
    baseStrength: H,
    erosionChannelStrengths: P,
    erosionStrengthBase: v,
    erosionStrengthPeak: x,
    erosionShape: T,
    baseWeatherStrength: _,
    baseWeatherHeightStart: R,
    baseWeatherHeightEnd: b,
    edgeSoftness: f,
    edgeSoftnessFalloff: w,
    thickness: O
  } = n, k = h ? t.xz.sub(l.xz) : t.xz, C = c.mul(
    d.mul(D(s, a(0)))
  ), N = h ? t.sub(l).sub(C).add(c.mul(y)).toVar() : t.sub(C).toVar(), V = i.sample(k.div(p)).level(a(0)).toVar(), U = r.sample(N.div(m)).level(e), L = is(
    U,
    A,
    !0
  ).mul(H).toVar(), Y = V.r.add(o.sub(a(1))).add(L.mul(o)), I = ue(
    s.div(D(Y, a(1e-3))),
    a(0),
    a(1)
  ), E = D(s, a(0)).mul(O).mul(1e-3), F = f.div(
    Ds(D(w, a(1e-3)), E)
  ), K = D(F, a(1e-4)).toVar(), ee = R.add(a(1e-3)).max(b), te = ye(
    R,
    ee,
    s
  ).oneMinus().mul(_), q = ye(
    te.sub(la),
    te,
    V.r
  ).toVar(), G = (B, J) => {
    const $ = V.r.add(o.sub(a(1))).add(J.mul(o)), ne = ye(
      K.negate(),
      K,
      $.sub(s)
    ), ce = B.negate().mul(o), oe = ye(
      K.negate(),
      K,
      s.sub(ce)
    );
    return ne.mul(oe).mul(q);
  };
  return {
    conservative: G(a(0), L).toVar(),
    withErosion: (B) => {
      const J = r.sample(N.div(S)).level(B), $ = ae(
        J.oneMinus(),
        J,
        T
      ), ne = ae(
        v,
        x,
        I
      ), ce = is(
        $,
        P,
        !1
      ).mul(ne).toVar(), oe = L.add(ce);
      return G(ce, oe);
    }
  };
}
function Fs(n) {
  return Lt(n, n.lods.base).withErosion(n.lods.erosion);
}
function ha(n) {
  return Lt(n, n.lods.base).conservative;
}
const Le = { r: 0.7, g: 0.41, b: 0.23 }, Ie = { r: 0.113, g: 0.04, b: 0.02 };
function ua(n) {
  const { cloud: e, animatedClouds: t, quality: s, planetCenter: i, planetRadius: o } = n, { weatherNode: r, baseNode: h } = n, l = e.shape, c = e.wind, d = [
    a(Le.r),
    a(Le.g),
    a(Le.b)
  ], y = [
    a(Ie.r),
    a(Ie.g),
    a(Ie.b)
  ], p = l.baseScale.mul(l.erosionScaleBaseMultiplier), m = a(0).toVar(), S = a(0).toVar(), A = l.coverage.toVar(), H = {
    weather: r,
    base: h,
    animatedClouds: t,
    windOffset: c.offset,
    windDirection: c.direction,
    windSkew: c.skew,
    evolutionOffset: c.evolutionOffset,
    coverage: A,
    weatherScale: l.weatherScale,
    baseScale: l.baseScale,
    erosionScale: p,
    baseChannelStrengths: d,
    baseStrength: l.baseStrength,
    erosionChannelStrengths: y,
    erosionStrengthBase: l.erosionStrengthBase,
    erosionStrengthPeak: l.erosionStrengthPeak,
    erosionShape: l.erosionShape,
    baseWeatherStrength: l.baseWeatherStrength,
    baseWeatherHeightStart: l.baseWeatherHeightStart,
    baseWeatherHeightEnd: l.baseWeatherHeightEnd,
    edgeSoftness: l.edgeSoftness,
    edgeSoftnessFalloff: l.edgeSoftnessFalloff,
    thickness: l.thickness
  }, P = (b) => {
    const f = b.x.sub(i.x), w = b.z.sub(i.z), O = f.mul(f).add(w.mul(w));
    return b.y.sub(l.altitude).add(O.div(o.mul(2))).div(l.thickness);
  }, v = (b) => {
    const f = l.horizonCoverageStart, w = f.add(D(l.horizonCoverageRamp, a(1))), O = ye(f, w, b);
    return l.coverage.add(l.horizonCoverageAmount.mul(O));
  }, x = (b) => Je(
    b.mul(s.pixelConeAngle),
    l.baseScale,
    s.baseShapeResolution,
    s.mipBaseLevel
  ), T = (b) => Je(
    b.mul(s.pixelConeAngle),
    p,
    s.baseShapeResolution,
    s.mipBaseLevel
  ), _ = (b, f) => {
    const w = a(0).toVar(), O = P(b).toVar();
    return W(O.greaterThan(-0.5).and(O.lessThan(1.5)), () => {
      w.assign(
        (f ? ha : Fs)({
          ...H,
          position: b,
          shellHeightFraction: O,
          lods: {
            base: m,
            erosion: S
          }
        })
      );
    }), w;
  }, R = (b, f, w) => {
    A.assign(v(w));
    const O = Lt(
      {
        ...H,
        position: b,
        shellHeightFraction: f
      },
      x(w)
    );
    return {
      conservative: O.conservative,
      withErosion: () => O.withErosion(T(w))
    };
  };
  return {
    primary: (b, f, w) => R(b, f, w).withErosion(),
    primaryCandidate: R,
    full: (b) => _(b, !1),
    cheap: (b) => _(b, !0),
    shellHeightFractionAt: P,
    // One frozen LOD for the whole light cone, from its (larger) cone footprint.
    // `cheap` is the same runtime branch condition `lightConeEnergy` uses to pick
    // `sampler.cheap`/`sampler.full` — the erosion LOD only needs computing on the
    // `full` side, since the `cheap` density sample never reads it.
    freezeLightLodAt: (b, f) => {
      m.assign(
        Je(b, l.baseScale, s.baseShapeResolution, s.mipBaseLevel)
      ), W(f.not(), () => {
        S.assign(
          Je(b, p, s.baseShapeResolution, s.mipBaseLevel)
        );
      });
    }
  };
}
const Pt = {
  FARTHEST: 1,
  RECIPROCAL: 3
}, as = 2e-3, ca = 0.05, da = 65e3, pa = 64e3, nt = 6e4, ma = 4, Ws = 4, ga = 3, ya = 1, Sa = 3, va = 0.15, fa = 0.15;
function Aa(n) {
  const {
    rayOrigin: e,
    rayDir: t,
    planetRadius: s,
    planetCenter: i,
    cloud: o,
    quality: r,
    sun: h,
    buildLighting: l,
    weatherNode: c,
    baseNode: d,
    startDitherFraction: y,
    luminance: p,
    transmittance: m,
    depth: S,
    hitDistanceMode: A
  } = n, H = s.add(o.shape.altitude).toVar(), P = H.add(o.shape.thickness).toVar(), { tStart: v, tEnd: x, valid: T } = Ha({
    rayOrigin: e,
    rayDir: t,
    planetCenter: i,
    planetRadius: s,
    innerR: H,
    outerR: P,
    maxMarchDist: o.fade.maxMarchDist
  }), _ = l(
    T.greaterThan(0.5).and(x.greaterThan(v))
  ), {
    sunTint: R,
    octavePhasesSun: b,
    zenithRadiance: f,
    horizonRadiance: w,
    groundBounceRadiance: O,
    moonNodes: k,
    octavePhasesMoon: C,
    sunConeOffsets: N
  } = _, V = ua({
    cloud: o,
    animatedClouds: n.animatedClouds,
    quality: r,
    planetCenter: i,
    planetRadius: s,
    weatherNode: c,
    baseNode: d
  });
  ba({
    rayOrigin: e,
    rayDir: t,
    sampler: V,
    tStart: v,
    tEnd: x,
    valid: T,
    startDitherFraction: y,
    maxSteps: r.maxSteps,
    earlyExit: r.earlyExitTransmittance,
    baseStep: r.baseStepSize,
    stepConeFactor: r.stepConeFactor,
    stepConeAngle: r.stepConeAngle,
    maxOpticalDepthPerStep: r.maxOpticalDepthPerStep,
    pixelConeAngle: r.pixelConeAngle,
    luminance: p,
    transmittance: m,
    depth: S,
    hitDistanceMode: A,
    extinction: o.shape.density,
    albedo: o.lighting.scatteringAlbedo,
    powderStrength: o.lighting.powderStrength,
    ambientIntensity: o.lighting.ambientIntensity,
    baseShadowStrength: o.lighting.baseShadowStrength,
    baseShadowHeight: o.lighting.baseShadowHeight,
    zenithRadiance: f,
    horizonRadiance: w,
    groundBounceRadiance: O,
    fullLightingAlpha: r.fullLightingAlpha,
    sunColor: h.color,
    sunIntensity: h.intensity,
    sunTint: R,
    octavePhasesSun: b,
    sunConeOffsets: N,
    moonNodes: k,
    octavePhasesMoon: C,
    msScatter: a(Gi),
    lightStepSize: r.lightStepSize
  });
}
function ba(n) {
  const {
    valid: e,
    tStart: t,
    tEnd: s,
    startDitherFraction: i,
    maxSteps: o,
    earlyExit: r,
    baseStep: h,
    stepConeFactor: l,
    stepConeAngle: c,
    transmittance: d
  } = n;
  W(e.greaterThan(0.5).and(s.greaterThan(t)), () => {
    const y = h.toVar(), p = (A) => D(y, l.mul(c).mul(A)), m = t.add(
      i.mul(p(t))
    ), S = {
      ...n,
      t: m.toVar(),
      stepSize: y.mul(Ws).toVar(),
      effectiveBaseStep: y.toVar(),
      coarse: a(1).toVar(),
      emptyRun: a(0).toVar(),
      opticalDepthAccum: a(0).toVar(),
      fineStepAt: p
    };
    ke(o, () => {
      W(d.lessThan(r), () => {
        d.assign(a(0)), Ut();
      }), W(S.t.greaterThan(s), () => {
        Ut();
      }), xa(S);
    });
  });
}
function xa(n) {
  const {
    rayOrigin: e,
    rayDir: t,
    sampler: s,
    t: i,
    stepSize: o,
    effectiveBaseStep: r,
    coarse: h,
    fineStepAt: l
  } = n;
  r.assign(l(i));
  const c = r.mul(Ws).toVar(), d = e.add(t.mul(i)).toVar(), y = s.shellHeightFractionAt(d).toVar(), p = { pos: d, shellHeightFraction: y, effectiveLargeStep: c };
  W(h.greaterThan(0.5), () => {
    Ta(n, p);
  }).Else(() => {
    wa(n, p);
  }), i.addAssign(o);
}
function Ta(n, e) {
  const { sampler: t, t: s, tStart: i, stepSize: o, effectiveBaseStep: r, coarse: h, emptyRun: l } = n, { pos: c, shellHeightFraction: d, effectiveLargeStep: y } = e, p = t.primaryCandidate(c, d, s);
  W(p.conservative.greaterThan(0), () => {
    const m = p.withErosion();
    W(m.greaterThan(0), () => {
      s.assign(D(s.sub(y), i)), h.assign(a(0)), l.assign(a(0)), o.assign(r);
    }).Else(() => {
      o.assign(y);
    });
  }).Else(() => {
    o.assign(y);
  });
}
function wa(n, e) {
  const { sampler: t, t: s, stepSize: i, effectiveBaseStep: o, coarse: r, emptyRun: h } = n, { pos: l, shellHeightFraction: c, effectiveLargeStep: d } = e, y = t.primary(l, c, s).toVar();
  W(y.greaterThan(0), () => {
    h.assign(a(0)), Ma(n, e, y);
  }).Else(() => {
    h.addAssign(a(1)), i.assign(o), W(h.greaterThanEqual(a(ma)), () => {
      r.assign(a(1)), i.assign(d);
    });
  });
}
function Ma(n, e, t) {
  const {
    sampler: s,
    t: i,
    stepSize: o,
    effectiveBaseStep: r,
    opticalDepthAccum: h,
    maxOpticalDepthPerStep: l,
    pixelConeAngle: c,
    fullLightingAlpha: d,
    extinction: y,
    albedo: p,
    powderStrength: m,
    ambientIntensity: S,
    baseShadowStrength: A,
    baseShadowHeight: H,
    zenithRadiance: P,
    horizonRadiance: v,
    groundBounceRadiance: x,
    sunColor: T,
    sunIntensity: _,
    sunTint: R,
    octavePhasesSun: b,
    sunConeOffsets: f,
    moonNodes: w,
    octavePhasesMoon: O,
    luminance: k,
    transmittance: C,
    depth: N
  } = n, { pos: V, shellHeightFraction: U } = e, L = ue(U, 0, 1).toVar(), Y = t.mul(y).toVar(), I = ue(
    l.div(D(Y, a(1e-6))),
    r.mul(va),
    r
  ).toVar(), E = ye(
    a(ya),
    a(Sa),
    h
  ), F = ae(
    I,
    r.mul(ga),
    E
  ).toVar();
  o.assign(F);
  const K = Y.mul(p).toVar(), ee = Yi(t, m).toVar(), Q = ae(
    a(fa),
    a(1),
    ye(a(0), H, L)
  ), te = ae(
    a(1),
    Q,
    A
  ).toVar(), q = C.oneMinus().greaterThanEqual(d);
  s.freezeLightLodAt(i.mul(c), q);
  const G = j(0).toVar();
  W(_.greaterThan(a(1e-4)), () => {
    G.assign(
      T.mul(R).mul(_).mul(
        ns(
          n,
          V,
          b,
          f,
          q,
          t
        )
      ).mul(ee).mul(te)
    );
  });
  const B = j(0).toVar();
  if (w) {
    const ve = w.moonSunFade;
    W(
      w.dir.y.greaterThan(a(0)).and(ve.greaterThan(a(0))),
      () => {
        B.assign(
          w.color.mul(w.intensity).mul(w.gain).mul(w.illum).mul(
            ns(
              n,
              V,
              O,
              w.coneOffsets,
              q,
              t
            )
          ).mul(ee).mul(te).mul(ve)
        );
      }
    );
  }
  const J = Qi({
    heightFraction: L,
    zenithRadiance: P,
    horizonRadiance: v,
    groundBounceRadiance: x,
    ambientIntensity: S
  }).toVar(), $ = G.add(B).add(J).mul(K).toVar(), ne = re(Y.negate().mul(F)).toVar(), ce = $.sub($.mul(ne)).div(D(Y, a(1e-7))).toVar();
  k.addAssign(C.mul(ce));
  const oe = C.mul(a(1).sub(ne)).toVar(), fe = D(i, a(1)).toVar();
  N.weightedDist.addAssign(fe.mul(oe)), W(n.hitDistanceMode.lessThan(a(0.5)), () => {
    const ve = oe.greaterThan(a(as));
    N.nearestDist.assign(
      pe(N.nearestDist, he(ve, fe, a(nt)))
    );
  }).Else(() => {
    W(n.hitDistanceMode.lessThan(a(1.5)), () => {
      const ve = oe.greaterThan(a(as));
      N.farthestDist.assign(
        D(N.farthestDist, he(ve, fe, a(0)))
      );
    }).Else(() => {
      W(n.hitDistanceMode.greaterThanEqual(a(Pt.RECIPROCAL)), () => {
        N.weightedInvDist.addAssign(oe.div(fe));
      });
    });
  }), C.mulAssign(ne), h.addAssign(Y.mul(F));
}
function ns(n, e, t, s, i, o) {
  const {
    sampler: r,
    extinction: h,
    msScatter: l,
    lightStepSize: c
  } = n, d = (p) => Ki({
    position: e,
    extinction: h,
    octavePhases: t,
    msScatter: l,
    originStepLength: c,
    packedOffsets: s,
    densityAt: p,
    originDensity: o
  }), y = a(0).toVar();
  return W(i, () => {
    y.assign(d(r.cheap));
  }).Else(() => {
    y.assign(d(r.full));
  }), y;
}
function Ha(n) {
  const {
    rayOrigin: e,
    rayDir: t,
    planetCenter: s,
    planetRadius: i,
    innerR: o,
    outerR: r,
    maxMarchDist: h
  } = n, l = Ee(e, t, s, r).toVar(), c = Ee(e, t, s, o).toVar(), d = Ee(
    e,
    t,
    s,
    i
  ).toVar(), y = a(1e30).toVar();
  W(d.x.greaterThan(0), () => {
    y.assign(d.x);
  });
  const p = a(0).toVar(), m = a(0).toVar(), S = a(0).toVar();
  W(l.y.greaterThan(0), () => {
    m.assign(l.y), S.assign(a(1));
  });
  const A = Oe(e.sub(s)).toVar();
  return W(A.lessThan(o), () => {
    p.assign(c.y);
  }).Else(() => {
    W(A.greaterThan(r), () => {
      p.assign(D(l.x, 0));
    }), W(c.x.greaterThanEqual(0), () => {
      m.assign(pe(m, c.x));
    });
  }), m.assign(pe(m, y)), m.assign(pe(m, h)), { tStart: p, tEnd: m, valid: S };
}
const os = 1.5, Da = 2.399963, Pa = Math.fround(0.99);
class $e {
  /** TSL uniforms consumed directly by the unrolled light march. */
  nodes;
  /** Compile-time tap count represented by this uniform set, including the reused origin tap. */
  taps;
  _values;
  _lastDirection = new M.Vector3(NaN, NaN, NaN);
  _lastStepSize = NaN;
  _lastConeSpread = NaN;
  // Persistent CPU scratch: updating animated celestial directions allocates nothing.
  _seed = new M.Vector3();
  _direction = new M.Vector3();
  _tangent = new M.Vector3();
  _bitangent = new M.Vector3();
  _offset = new M.Vector3();
  constructor(e) {
    this.taps = Math.max(1, Math.round(e)), this._values = Array.from(
      { length: this.taps - 1 },
      () => new M.Vector4()
    ), this.nodes = this._values.map((t) => g(t));
  }
  /** Rebuild the packed offsets only when direction or cone geometry changed. */
  update(e, t, s) {
    if (this._lastDirection.equals(e) && this._lastStepSize === t && this._lastConeSpread === s)
      return !1;
    this._lastDirection.copy(e), this._lastStepSize = t, this._lastConeSpread = s, this._direction.set(
      Math.fround(e.x),
      Math.fround(e.y),
      Math.fround(e.z)
    );
    const i = Math.fround(t), o = Math.fround(s);
    this._seed.set(0, 1, 0), Math.abs(this._direction.y) > Pa && this._seed.set(1, 0, 0), this._tangent.crossVectors(this._seed, this._direction).normalize(), this._bitangent.crossVectors(this._direction, this._tangent);
    for (let r = 1; r < this.taps; r += 1) {
      const h = Math.fround(Math.pow(os, r)), l = Math.fround(
        (h - 1) / (os - 1)
      ), c = Math.fround(l + h * 0.5), d = i * c, y = r * Da, p = Math.sqrt((r + 0.5) / this.taps), m = Math.fround(Math.cos(y) * p), S = Math.fround(Math.sin(y) * p);
      this._offset.copy(this._tangent).multiplyScalar(m).addScaledVector(this._bitangent, S).multiplyScalar(o * d).addScaledVector(this._direction, d), this._values[r - 1].set(
        this._offset.x,
        this._offset.y,
        this._offset.z,
        i * h
      );
    }
    return !0;
  }
}
const Te = ie.EARTH_R_KM * 1e3;
class Gs extends u.MeshBasicNodeMaterial {
  /** Shared atmospheric scattering state, driving aerial perspective and the horizon melt. */
  atmosphere;
  /** Shared sun state: direction, color, intensity. */
  sun;
  /** Shared cloud state: shape, lighting, wind, cirrus, haze, and fade groups. */
  cloud;
  /** Per-instance march cost knobs — step counts, dither strength, cone angles. */
  quality;
  /** Time-of-day state, or `null` to compile the moon-key term out. */
  timeOfDay;
  /** Whether wind drift/evolution nodes are present in this material's graph. */
  animatedClouds;
  _ambientSky;
  /** Per-fragment ray direction node. World space, normalized. */
  rayDirOverride;
  /** Per-fragment ray origin node — the camera position. World space, meters. */
  rayOriginOverride;
  // Separate packed sets preserve the existing twilight interval where sun and moon
  // cone lighting can both contribute. At the default six taps each set is five vec4s.
  _sunConeOffsets;
  _moonConeOffsets;
  /** Virtual planet center. World space, meters; keep at `(cam.x, -PLANET_RADIUS, cam.z)` per frame. */
  planetCenter = g(new u.Vector3(0, -Te, 0));
  /**
   * Which depth along the ray each pixel stores as its hit distance — a
   * {@link HIT_DISTANCE_MODE} value. Only the stored distance follows this; aerial
   * perspective and the horizon melt always use the coverage-weighted linear mean.
   */
  hitDistanceMode = g(a(Pt.FARTHEST));
  /** Mipped base-shape noise volume. Required before {@link init}. */
  baseShapeTexture = null;
  /** Weather map; R = coverage in [0,1]. Required before {@link init}. */
  weatherTexture = null;
  /** Cirrus-deck mask composited behind the volumetric clouds. `null` omits the deck. */
  cirrusTexture = null;
  /** Blue-noise tile for the ray-start dither. `null` marches un-dithered. */
  blueNoiseTexture = null;
  /** Sky transmittance LUT. Set together with {@link multiScatterLUT} to enable aerial perspective. */
  transmittanceLUT = null;
  /** Multiple-scattering LUT. Aerial perspective needs this and {@link transmittanceLUT}. */
  multiScatterLUT = null;
  /** Shared angular sky radiance for the horizon convergence target. */
  skyViewLUT = null;
  /** Camera-aligned froxel atlas containing aerial-perspective RGB in-scatter. */
  aerialInscatterLUT = null;
  /** Camera-aligned froxel atlas containing aerial-perspective RGB transmittance. */
  aerialTransmittanceLUT = null;
  _aerialPerspective = null;
  // Distance along the primary ray to the first density hit (m); misses store a far sentinel.
  _rayHitDistProp = ht("float", "cloudRayHitDist");
  /**
   * @param atmosphere Shared atmospheric scattering state.
   * @param sun Shared sun state.
   * @param cloud Shared cloud state.
   * @param quality Per-instance march cost knobs.
   * @param rayDirOverride Per-fragment ray direction node. World space, normalized.
   * @param rayOriginOverride Per-fragment ray origin node — camera position, world space, meters.
   * @param animatedClouds Include time-animated cloud coordinates in the shader graph.
   * @param timeOfDay Time-of-day state, or `null` for no moon key.
   * @param ambientSky Baked ambient-sky source for the fill light.
   */
  constructor(e, t, s, i, o, r, h, l = null, c) {
    super(), this.atmosphere = e, this.sun = t, this.cloud = s, this.quality = i, this.animatedClouds = h, this.timeOfDay = l, this._ambientSky = c, this.rayDirOverride = o, this.rayOriginOverride = r, this._sunConeOffsets = new $e(i.lightMarchTaps), this._moonConeOffsets = l ? new $e(i.lightMarchTaps) : null, this.updateLightConeOffsets(), this.transparent = !0, this.depthWrite = !1, this.fog = !1, this.blending = u.CustomBlending, this.blendEquation = u.AddEquation, this.blendSrc = u.OneFactor, this.blendDst = u.OneMinusSrcAlphaFactor, this.blendEquationAlpha = u.AddEquation, this.blendSrcAlpha = u.OneFactor, this.blendDstAlpha = u.OneMinusSrcAlphaFactor;
  }
  /**
   * Build the shader. Call once {@link baseShapeTexture} and {@link weatherTexture} are
   * assigned; throws otherwise.
   *
   * @param options.mrt Defaults to `true`. Pass `false` for single-attachment baking, which
   * emits color only and no ray-hit distance.
   */
  init(e = {}) {
    if (!this.baseShapeTexture || !this.weatherTexture)
      throw new Error("All noise textures must be set before building CloudMaterial");
    this._aerialPerspective = this.transmittanceLUT && this.multiScatterLUT ? zs(this.transmittanceLUT, this.multiScatterLUT) : null, this._ensureLightConeOffsetLayout(), this.updateLightConeOffsets(), this.colorNode = this._buildColorNode(), e.mrt !== !1 && (this.mrtNode = Ct({
      output: Nt,
      rayHitDist: se(this._rayHitDistProp, 0, 0, 1)
    }));
  }
  /** Rebuild the color node against the currently assigned textures and mark the material dirty. */
  rebuildShader() {
    this._ensureLightConeOffsetLayout(), this.updateLightConeOffsets(), this.colorNode = this._buildColorNode(), this.needsUpdate = !0;
  }
  /** Refresh CPU-packed sun/moon cone taps when light direction or cone geometry changed. */
  updateLightConeOffsets() {
    const e = this.quality.lightStepSize.value, t = this.quality.lightConeSpread.value;
    this._sunConeOffsets.update(this.sun.direction.value, e, t), this._moonConeOffsets && this.timeOfDay && this._moonConeOffsets.update(
      this.timeOfDay.moonDirection.value,
      e,
      t
    );
  }
  /** Recreate the aligned uniform layout only when the compile-time tap count changes. */
  _ensureLightConeOffsetLayout() {
    const e = this.quality.lightMarchTaps;
    this._sunConeOffsets.taps !== e && (this._sunConeOffsets = new $e(e), this._moonConeOffsets = this.timeOfDay ? new $e(e) : null);
  }
  /** Swap noise textures on an already-built material and recompile. Omitted entries keep their current texture. */
  setNoiseTextures(e) {
    e.baseShape && (this.baseShapeTexture = e.baseShape), e.weather && (this.weatherTexture = e.weather), this.rebuildShader();
  }
  /** Set the cirrus-deck mask, or clear it with `null` to drop the deck. Recompiles the shader. */
  setCirrusTexture(e) {
    this.cirrusTexture = e, this.rebuildShader();
  }
  _buildColorNode() {
    const e = a(Te), t = this.planetCenter, s = this._rayHitDistProp, i = de(this.weatherTexture), o = Ps(this.baseShapeTexture), r = this.blueNoiseTexture ? de(this.blueNoiseTexture) : null, h = this.blueNoiseTexture?.image.width ?? 1, l = this.cirrusTexture, c = this.weatherTexture, d = this.rayOriginOverride, y = this.rayDirOverride, p = this.atmosphere, m = this.sun, S = this.cloud, A = this.quality, H = this.timeOfDay, P = this._sunConeOffsets.nodes, v = this._moonConeOffsets?.nodes ?? null, x = this._ambientSky, T = this._aerialPerspective, _ = this.aerialInscatterLUT, R = this.aerialTransmittanceLUT, b = this.skyViewLUT, f = !b && this.transmittanceLUT && this.multiScatterLUT ? qe(this.transmittanceLUT, this.multiScatterLUT) : null;
    return le(() => {
      const w = d.toVar(), O = y.toVar(), k = j(0).toVar(), C = a(1).toVar(), N = {
        weightedDist: a(0).toVar(),
        weightedInvDist: a(0).toVar(),
        nearestDist: a(nt).toVar(),
        farthestDist: a(0).toVar()
      }, V = r ? r.sample(Os.div(a(h))).r.toVar() : a(0), U = r ? Ke(V.add(A.ditherTemporalPhase)).mul(A.ditherStrength) : a(0);
      let L, Y;
      Aa({
        rayOrigin: w,
        rayDir: O,
        planetRadius: e,
        planetCenter: t,
        cloud: S,
        quality: A,
        sun: m,
        animatedClouds: this.animatedClouds,
        buildLighting: (G) => (Y = G, L = $i({
          rayDir: O,
          sun: m,
          cloud: S,
          timeOfDay: H,
          ambientSky: x,
          sunConeOffsets: P,
          moonConeOffsets: v,
          enabled: G
        }), L),
        weatherNode: i,
        baseNode: o,
        startDitherFraction: U,
        luminance: k,
        transmittance: C,
        depth: N,
        hitDistanceMode: this.hitDistanceMode
      });
      const I = a(1).sub(C).toVar(), E = N.weightedDist.div(D(I, a(1e-4))).toVar(), F = E, K = a(F).toVar();
      W(this.hitDistanceMode.lessThan(a(0.5)), () => {
        K.assign(he(
          N.nearestDist.lessThan(a(nt)),
          N.nearestDist,
          F
        ));
      }).Else(() => {
        W(this.hitDistanceMode.lessThan(a(1.5)), () => {
          K.assign(he(
            N.farthestDist.greaterThan(a(0)),
            N.farthestDist,
            F
          ));
        }).Else(() => {
          W(this.hitDistanceMode.greaterThanEqual(a(Pt.RECIPROCAL)), () => {
            K.assign(I.div(D(N.weightedInvDist, a(1e-9))));
          });
        });
      });
      const ee = ue(K, a(1), a(nt)), Q = ye(0, ca, I), te = a(1).div(
        D(
          Q.div(ee).add(Q.oneMinus().div(a(da))),
          a(1e-9)
        )
      ).toVar();
      if (W(I.greaterThan(a(1e-4)), () => {
        if (_ && R) {
          const $ = oa(
            _,
            R,
            ge(),
            E,
            S.fade.maxMarchDist
          );
          k.assign(
            k.mul($.transmittance).add($.inscatter.mul(m.intensity).mul(I))
          );
        } else if (T) {
          const $ = T({
            viewDir: O,
            sunDir: m.direction,
            turbidity: p.turbidity,
            mieG: p.mieDirectionalG,
            rayleigh: p.rayleigh,
            // Scale MS by the dome knob, not the cloud-ambient fill.
            skyMultipleScattering: p.skyMultipleScattering,
            mieScatteringStrength: p.mieScatteringStrength,
            maxDist: E.mul(1e-3),
            // m → km
            densityScale: S.fade.hazeDensityScale
          });
          k.assign(
            k.mul($.transmittance).add($.inscatter.mul(m.intensity).mul(I))
          );
        } else {
          const $ = re(
            a(0.02).mul(S.fade.hazeDensityScale).negate().mul(E).mul(1e-3)
          ).toVar(), ne = ue(O.y, 0, 1), ce = ae(L.horizonRadiance, L.zenithRadiance, ne).toVar();
          k.assign(ae(ce.mul(I), k, $));
        }
        const G = D(S.fade.horizonMeltEnd, S.fade.horizonMeltStart.add(1)), B = ye(S.fade.horizonMeltStart, G, E), J = b ? Et(b, O, m.direction).mul(m.intensity) : f ? f(
          O,
          m.direction,
          p.turbidity,
          p.mieDirectionalG,
          p.skyMultipleScattering,
          p.mieScatteringStrength,
          p.rayleigh
        ).mul(m.intensity) : ae(
          L.horizonRadiance,
          L.zenithRadiance,
          ue(O.y, 0, 1)
        );
        k.assign(ae(k, J.mul(I), B));
      }), l) {
        const G = Ls({
          rayDir: O,
          sun: m,
          ambientSky: x,
          enabled: Y.not()
        }), B = Is({
          rayOrigin: w,
          rayDir: O,
          planetCenter: t,
          planetRadius: e,
          cirrusTexture: l,
          scale: S.cirrus.scale,
          strength: S.cirrus.strength,
          weatherTexture: c,
          hazeScale: S.haze.scale,
          hazeDensity: S.haze.density,
          horizonMeltStart: S.fade.horizonMeltStart,
          horizonMeltEnd: S.fade.horizonMeltEnd,
          windOffset: S.wind.offset,
          animatedClouds: this.animatedClouds,
          sunColor: m.color,
          sunIntensity: m.intensity,
          sunTint: L.sunTint,
          phaseSun: he(
            Y,
            L.octavePhasesSun[0],
            G.phaseSun
          ),
          zenithRadiance: L.zenithRadiance
        }), J = a(1).sub(I);
        k.addAssign(B.rgb.mul(B.a).mul(J)), I.addAssign(B.a.mul(J));
      }
      const q = se(k, I);
      return s.assign(te), q;
    })();
  }
}
class Us extends u.MeshBasicNodeMaterial {
  /** Shared atmospheric scattering state. */
  atmosphere;
  /** Shared sun state: direction, color, intensity. */
  sun;
  /** Shared cloud state. This material reads the `cirrus`, `haze`, `fade`, and `wind` groups. */
  cloud;
  /** Time-of-day state, or `null` to compile the moon-lit terms out. */
  timeOfDay;
  /** Whether wind drift nodes are present in this material's graph. */
  animatedClouds;
  _ambientSky;
  /** Per-fragment ray direction node. World space, normalized. */
  rayDirOverride;
  /** Per-fragment ray origin node — the camera position. World space, meters. */
  rayOriginOverride;
  /** Grayscale cirrus mask. `null` draws nothing. Set it through {@link setCirrusTexture}. */
  cirrusTexture = null;
  /** Procedural weather map; R = coverage in [0,1], driving the storm haze on this deck. */
  weatherTexture;
  /**
   * @param atmosphere Shared atmospheric scattering state.
   * @param sun Shared sun state.
   * @param cloud Shared cloud state.
   * @param rayDirOverride Per-fragment ray direction node. World space, normalized.
   * @param rayOriginOverride Per-fragment ray origin node — camera position, world space, meters.
   * @param weatherTexture Procedural weather map; R = coverage in [0,1].
   * @param timeOfDay Time-of-day state, or `null` for no moon-lit terms.
   * @param ambientSky Baked ambient-sky source for the fill light.
   */
  constructor(e, t, s, i, o, r, h, l = null, c) {
    super(), this.atmosphere = e, this.sun = t, this.cloud = s, this.animatedClouds = h, this.timeOfDay = l, this._ambientSky = c, this.rayDirOverride = i, this.rayOriginOverride = o, this.weatherTexture = r, this.transparent = !0, this.depthWrite = !1, this.fog = !1, this.depthTest = !0, this.blending = u.CustomBlending, this.blendEquation = u.AddEquation, this.blendSrc = u.OneFactor, this.blendDst = u.OneMinusSrcAlphaFactor, this.blendEquationAlpha = u.AddEquation, this.blendSrcAlpha = u.OneFactor, this.blendDstAlpha = u.OneMinusSrcAlphaFactor, this.vertexNode = jt(), this.depthNode = a(1), this.colorNode = this._buildColorNode();
  }
  /**
   * Set the cirrus mask, or clear it with `null` so the deck draws nothing. Recompiles the
   * shader.
   */
  setCirrusTexture(e) {
    this.cirrusTexture !== e && (this.cirrusTexture = e, this.colorNode = this._buildColorNode(), this.needsUpdate = !0);
  }
  /** Swap the procedural weather map and recompile the sampler binding. */
  setWeatherTexture(e) {
    this.weatherTexture !== e && (this.weatherTexture = e, this.colorNode = this._buildColorNode(), this.needsUpdate = !0);
  }
  _buildColorNode() {
    const e = this.cirrusTexture, t = this.weatherTexture, s = this.rayDirOverride, i = this.rayOriginOverride, o = this.sun, r = this.cloud, h = this._ambientSky;
    return le(() => {
      if (!e)
        return se(0, 0, 0, 0);
      const l = i.toVar(), c = s.toVar(), d = Ls({
        rayDir: c,
        sun: o,
        ambientSky: h
      }), y = j(
        l.x,
        a(-Te),
        l.z
      ), p = Is({
        rayOrigin: l,
        rayDir: c,
        planetCenter: y,
        planetRadius: a(Te),
        cirrusTexture: e,
        scale: r.cirrus.scale,
        strength: r.cirrus.strength,
        weatherTexture: t,
        hazeScale: r.haze.scale,
        hazeDensity: r.haze.density,
        horizonMeltStart: r.fade.horizonMeltStart,
        horizonMeltEnd: r.fade.horizonMeltEnd,
        windOffset: r.wind.offset,
        animatedClouds: this.animatedClouds,
        sunColor: o.color,
        sunIntensity: o.intensity,
        sunTint: d.sunTint,
        phaseSun: d.phaseSun,
        zenithRadiance: d.zenithRadiance
      });
      return se(p.rgb.mul(p.a), p.a);
    })();
  }
}
class Oa {
  /** The cirrus material. */
  material;
  /** Backdrop mesh. Add it to your scene. */
  mesh;
  /**
   * @param rayBasis `SkyPass.rayBasis`.
   * @param cameraPositionUniform `SkyPass.cameraPositionUniform`.
   * @param weatherTexture weather map (2D) — the same texture the cloud march reads.
   * @param timeOfDay when supplied, adds the moon-key term.
   * @param ambientSky baked ambient-sky terms lighting the deck.
   */
  constructor(e, t, s, i, o, r, h = null, l, c) {
    this.material = new Us(
      e,
      t,
      s,
      ct(i),
      o,
      r,
      c,
      h,
      l
    ), this.mesh = new u.Mesh(X.geometry(), this.material), pt(this.mesh, dt.backgroundOverlay, 5), this.mesh.frustumCulled = !1;
  }
  /** Set (or clear with `null`) the cirrus mask. */
  setTexture(e) {
    this.material.setCirrusTexture(e);
  }
  dispose() {
    this.material.dispose();
  }
}
function _a(n = 64) {
  const e = Ra(n), t = n * n, s = new Uint8Array(t);
  for (let o = 0; o < t; o++)
    s[o] = Math.min(255, Math.floor((e[o] + 0.5) / t * 256));
  const i = new u.DataTexture(
    s,
    n,
    n,
    u.RedFormat,
    u.UnsignedByteType
  );
  return i.wrapS = u.RepeatWrapping, i.wrapT = u.RepeatWrapping, i.minFilter = u.NearestFilter, i.magFilter = u.NearestFilter, i.needsUpdate = !0, i;
}
function Ra(n) {
  const e = n * n, t = 1.9, s = Math.max(1, Math.ceil(t * 3)), i = 2 * t * t, o = [];
  for (let v = -s; v <= s; v++)
    for (let x = -s; x <= s; x++) {
      const T = Math.exp(-(x * x + v * v) / i);
      T > 1e-4 && o.push({ dx: x, dy: v, weight: T });
    }
  const r = new Uint8Array(e), h = new Float32Array(e), l = (v, x) => {
    const T = v % n, _ = v / n | 0;
    for (const R of o) {
      const b = (T + R.dx + n) % n, f = (_ + R.dy + n) % n;
      h[f * n + b] += x * R.weight;
    }
  };
  let c = 2654435769;
  const d = () => {
    c = c + 1831565813 >>> 0;
    let v = c;
    return v = Math.imul(v ^ v >>> 15, v | 1), v ^= v + Math.imul(v ^ v >>> 7, v | 61), ((v ^ v >>> 14) >>> 0) / 4294967296;
  }, y = () => {
    let v = -1, x = -1 / 0;
    for (let T = 0; T < e; T++)
      r[T] === 1 && h[T] > x && (x = h[T], v = T);
    return v;
  }, p = () => {
    let v = -1, x = 1 / 0;
    for (let T = 0; T < e; T++)
      r[T] === 0 && h[T] < x && (x = h[T], v = T);
    return v;
  }, m = Math.max(1, Math.round(e * 0.1));
  let S = 0;
  for (; S < m; ) {
    const v = d() * e | 0;
    r[v] === 0 && (r[v] = 1, l(v, 1), S++);
  }
  for (; ; ) {
    const v = y();
    r[v] = 0, l(v, -1);
    const x = p();
    if (r[x] = 1, l(x, 1), x === v) break;
  }
  const A = new Int32Array(e), H = r.slice(), P = h.slice();
  for (let v = m - 1; v >= 0; v--) {
    const x = y();
    r[x] = 0, l(x, -1), A[x] = v;
  }
  r.set(H), h.set(P);
  for (let v = m; v < e; v++) {
    const x = p();
    r[x] = 1, l(x, 1), A[x] = v;
  }
  return A;
}
const Ca = 0.6180339887498949;
class Na {
  /** The cloud material marched by this pass. */
  material;
  /** Fullscreen quad carrying `material`; lives in this pass' own `scene`. */
  mesh;
  /** Private scene the PassNode renders — not the user's scene. */
  scene;
  /** Tier-driven march budgets. `updateFrame` writes its per-frame cone-angle and dither uniforms. */
  quality;
  /** Camera axes rays are built from. Shared with the rest of the pipeline. */
  rayBasis;
  /** This frame's Bayer sub-position as an NDC offset. Written each frame. */
  ndcJitter = g(new u.Vector2());
  /** User-camera world position — the raymarch ray origin (the TSL `cameraPosition` builtin is wrong here). */
  cameraPositionUniform = g(new u.Vector3());
  /** PassNode wrapping the raymarch; sampling a texture node triggers it in `pipeline.render()`. */
  passNode;
  /** TextureNode for the color attachment. Sampling it triggers the pass. */
  outputTextureNode;
  /** TextureNode for the ray-hit-distance attachment. */
  hitDistTextureNode;
  _sourceDiv;
  // Blue-noise tile for the ray-start dither; generated once, owned + disposed here.
  _blueNoise;
  // Un-jittered main-camera projection snapshot, for the temporal pass' reprojection.
  _unjitteredProjection = new u.Matrix4();
  constructor(e, t, s, i, o, r, h, l = null, c, d, y) {
    this.quality = i, this.rayBasis = d, this._sourceDiv = h.sourceDiv, this.material = new Gs(
      e,
      t,
      s,
      i,
      ct(this.rayBasis, this.ndcJitter),
      this.cameraPositionUniform,
      // rayOriginOverride
      y,
      l,
      c
    ), this.material.baseShapeTexture = h.textures.baseShape, this.material.weatherTexture = h.textures.weather, this.material.transmittanceLUT = h.transmittanceLUT, this.material.multiScatterLUT = h.multiScatterLUT, this.material.skyViewLUT = h.skyViewLUT, this.material.aerialInscatterLUT = h.aerialInscatterLUT, this.material.aerialTransmittanceLUT = h.aerialTransmittanceLUT, this._blueNoise = _a(), this.material.blueNoiseTexture = this._blueNoise, this.material.init(), this.material.blending = u.NoBlending, this.mesh = new u.Mesh(X.geometry(), this.material), this.mesh.frustumCulled = !1, this.scene = new u.Scene(), this.scene.name = "sky-pro:cloud-march", this.scene.add(this.mesh), this.passNode = _s(this.scene, X.camera), this.passNode.setResolutionScale(1 / this._sourceDiv), this.passNode.setMRT(this.material.mrtNode), this.outputTextureNode = this.passNode.getTextureNode("output"), this.hitDistTextureNode = this.passNode.getTextureNode("rayHitDist");
    const p = this.passNode.getTexture("rayHitDist");
    p.format = u.RedFormat, p.type = u.HalfFloatType, p.minFilter = u.NearestFilter, p.magFilter = u.NearestFilter, this.passNode.setSize(o, r);
  }
  /** Starts/stops the march. `false` leaves the render target holding whatever it last drew. */
  setRenderEnabled(e) {
    this.passNode.updateBeforeType = e ? u.NodeUpdateType.FRAME : u.NodeUpdateType.NONE;
  }
  /**
   * Per-frame update; call before this pass renders. Slides the planet center, snapshots the un-sheared
   * projection, and writes the Bayer-sheared inverse-VP for this frame's active sub-position.
   */
  updateFrame(e, t, s) {
    this.material.updateLightConeOffsets(), this.material.planetCenter.value.set(
      e.position.x,
      -Te,
      e.position.z
    ), this.cameraPositionUniform.value.copy(e.position);
    const i = e.fov * Math.PI / 180;
    this.quality.pixelConeAngle.value = 2 * Math.tan(i / 2) / Math.max(1, s.screenHeight), this.quality.stepConeAngle.value = 2 * Math.tan(i / 2) / Math.max(1, s.historyHeight), this.quality.ditherTemporalPhase.value = t * Ca % 1, this._unjitteredProjection.copy(e.projectionMatrix);
    const o = s.freshCell, r = (s.lattice - 1) / 2, h = o.x - r, l = o.y - r;
    this.ndcJitter.value.set(
      2 * h / s.historyWidth,
      2 * l / s.historyHeight
    );
  }
  /** Snapshot of the projection matrix as it was before any jitter was applied. */
  get unjitteredProjection() {
    return this._unjitteredProjection;
  }
  /** Resolution divisor relative to screen, runtime-tunable. */
  get sourceDiv() {
    return this._sourceDiv;
  }
  set sourceDiv(e) {
    this._sourceDiv = e, this.passNode.setResolutionScale(1 / e);
  }
  /** Resize the march target. `width`/`height` are CSS px; `setSize` wants drawing-buffer px, so pre-multiply by `pixelRatio`. */
  resize(e, t, s) {
    this.passNode.setSize(e * s, t * s);
  }
  /** Width of the cloud source target after divisor is applied. */
  get sourceWidth() {
    return this.passNode.renderTarget.width;
  }
  /** Height of the cloud source target after divisor is applied. */
  get sourceHeight() {
    return this.passNode.renderTarget.height;
  }
  dispose() {
    this.passNode.dispose(), this.material.dispose(), this._blueNoise.dispose();
  }
}
function ka(n, e, t) {
  const s = e.mul(t), i = ze(s.sub(0.5)).add(0.5).toVar(), o = s.sub(i).toVar(), r = o.mul(o.mul(o.mul(-0.5).add(1)).add(-0.5)).toVar(), h = o.mul(o).mul(o.mul(1.5).sub(2.5)).add(1).toVar(), l = o.mul(o.mul(o.mul(-1.5).add(2)).add(0.5)).toVar(), c = o.mul(o).mul(o.mul(0.5).sub(0.5)).toVar(), d = h.add(l).toVar(), y = l.div(d).toVar(), p = i.sub(1).div(t).toVar(), m = i.add(2).div(t).toVar(), S = i.add(y).div(t).toVar(), A = n.sample(z(S.x, p.y)).mul(d.x.mul(r.y)).add(n.sample(z(p.x, S.y)).mul(r.x.mul(d.y))).add(
    n.sample(z(S.x, S.y)).mul(d.x.mul(d.y))
  ).add(n.sample(z(m.x, S.y)).mul(c.x.mul(d.y))).add(n.sample(z(S.x, m.y)).mul(d.x.mul(c.y))), H = d.x.mul(r.y).add(r.x.mul(d.y)).add(d.x.mul(d.y)).add(c.x.mul(d.y)).add(d.x.mul(c.y));
  return A.div(H);
}
const ja = 0.25, Va = 0.65, za = 8e3, Ea = 3e4, La = 0.15, Ia = 0.5, vt = 1, et = 1e9;
class Ba extends u.MeshBasicNodeMaterial {
  _cloudTexNode;
  _distTexNode;
  _historyTexNode;
  _prevDistTexNode;
  prevViewProjection = g(new u.Matrix4());
  cameraPos = g(new u.Vector3());
  prevCameraPos = g(new u.Vector3());
  // Cloud source (update-buffer) size; the fresh slot snaps to source texel centers.
  sourceSize = g(new u.Vector2(1, 1));
  // History (own output) target size in pixels; drives Catmull-Rom weights + texel metrics.
  historySize = g(new u.Vector2(1, 1));
  // Sub-position marched this frame (0..latticeSize-1); shared with CloudPass's shear.
  freshSlot = g(new u.Vector2(0, 0));
  // Active square lattice edge: 1/2/4. Runtime uniform so mode changes do not rebuild shaders.
  latticeSize = g(2);
  // 1 when the camera didn't move since last frame; skips the reprojection math and the
  // neighborhood clamp (nothing is rewarped, so the converged image must hold).
  cameraStatic = g(1);
  // 0 for one frame after cloud content changes; every slot then resolves from the
  // current march instead of retaining an incompatible silhouette or lighting state.
  historyValid = g(1);
  // Fresh-slot history retention at the near/far ends of the distance ramp.
  freshWeightNear = g(ja);
  freshWeightFar = g(Va);
  // Debug view: 0 off, 1 reprojection distance, 2 fallback only, 3 clamped history only.
  debugView = g(0);
  _rayBasis;
  // Shared properties so the MRT node can emit both distance histories.
  _consumerHitDistProp = ht("float", "temporalConsumerHitDist");
  _reprojectionHitDistProp = ht(
    "float",
    "temporalReprojectionHitDist"
  );
  constructor(e, t, s, i, o) {
    super(), this._rayBasis = o, this.transparent = !1, this.depthWrite = !1, this.fog = !1, this.depthTest = !1, this.blending = u.NoBlending, this._cloudTexNode = e, this._distTexNode = t, this._historyTexNode = s, this._prevDistTexNode = i, this.colorNode = this._buildColorNode(), this.mrtNode = Ct({
      output: Nt,
      hitDistHistory: se(
        this._consumerHitDistProp,
        this._reprojectionHitDistProp,
        0,
        1
      )
    });
  }
  _buildColorNode() {
    const e = this._cloudTexNode, t = this._distTexNode, s = this._historyTexNode, i = this._prevDistTexNode, o = this.prevViewProjection, r = this.cameraPos, h = this.prevCameraPos, l = this.sourceSize, c = this.historySize, d = this.freshSlot, y = this.latticeSize, p = this.cameraStatic, m = this.historyValid, S = this._consumerHitDistProp, A = this._reprojectionHitDistProp, H = this.freshWeightNear, P = this.freshWeightFar;
    return le(() => {
      const v = z(ge().x, a(1).sub(ge().y)).toVar(), x = z(
        ze(v.x.mul(l.x)).add(0.5).div(l.x),
        ze(v.y.mul(l.y)).add(0.5).div(l.y)
      ).toVar(), T = e.sample(x).toVar(), _ = y.sub(1).mul(0.5), R = v.add(
        z(
          _.sub(d.x).div(c.x),
          d.y.sub(_).div(c.y)
        )
      ), b = e.sample(R).toVar(), f = t.sample(x).x.toVar(), w = i.sample(v).toVar(), O = w.x.toVar(), k = w.y.toVar(), C = he(
        k.lessThan(a(vt)),
        a(et),
        k
      ).toVar(), N = he(
        C.greaterThanEqual(a(et)),
        f,
        C
      ).toVar(), V = se(T).toVar(), U = se(T).toVar();
      W(p.lessThanEqual(a(0.5)), () => {
        const gt = z(1, 1).div(l).toVar(), Qe = z(1, 1).div(c).toVar();
        for (let He = -1; He <= 1; He += 1)
          for (let Ue = -1; Ue <= 1; Ue += 1) {
            if (Ue === 0 && He === 0) continue;
            const we = z(Ue, He), Ze = e.sample(x.add(we.mul(gt))).level(a(0));
            V.assign(pe(V, Ze)), U.assign(D(U, Ze));
            const Ft = i.sample(v.add(we.mul(Qe))).level(a(0)).y;
            C.assign(pe(
              C,
              he(
                Ft.lessThan(a(vt)),
                a(et),
                Ft
              )
            ));
          }
        N.assign(he(
          C.greaterThanEqual(a(et)),
          f,
          C
        ));
      });
      const L = ze(Ke(v.mul(l)).mul(y)).toVar(), Y = L.x, I = y.sub(1).sub(L.y), E = Ne(Y.sub(d.x)).lessThan(0.5).and(Ne(I.sub(d.y)).lessThan(0.5)), F = z(v).toVar(), K = Xt(!0).toVar(), ee = Xt(!0).toVar(), Q = a(0).toVar(), te = a(k).toVar();
      W(p.lessThanEqual(a(0.5)), () => {
        const gt = kt(this._rayBasis, v).toVar(), Qe = r.add(gt.mul(N)).toVar(), He = o.mul(se(Qe, 1)).toVar(), we = He.xy.div(He.w).toVar().mul(0.5).add(0.5).toVar();
        F.assign(z(we.x, a(1).sub(we.y))), te.assign(
          i.sample(F).level(a(0)).y
        ), K.assign(
          He.w.greaterThan(0).and(we.x.greaterThanEqual(0)).and(we.x.lessThanEqual(1)).and(we.y.greaterThanEqual(0)).and(we.y.lessThanEqual(1))
        ), Q.assign(Oe(Qe.sub(h)));
        const Ze = Oe(F.sub(v).mul(c));
        ee.assign(
          Ze.lessThanEqual(a(Ia))
        );
      });
      const q = ka(
        s,
        F,
        c
      ).toVar();
      q.assign(
        se(D(q.xyz, j(0)), ue(q.w, 0, 1))
      );
      const G = m.greaterThan(a(0.5)).and(K).and(k.greaterThanEqual(a(vt))).toVar(), B = he(
        p.greaterThan(a(0.5)),
        q,
        ue(q, V, U)
      ).toVar(), J = he(
        G,
        B,
        b
      ).toVar(), $ = f.greaterThanEqual(
        a(pa)
      ), ne = he(
        $,
        H,
        ae(
          H,
          P,
          ye(
            a(za),
            a(Ea),
            f
          )
        )
      ), ce = he(
        G,
        ae(T, B, ne),
        T
      ).toVar(), oe = he(E, ce, J).toVar(), fe = Ne(Q.sub(te)).lessThanEqual(
        a(La).mul(Q)
      ), ve = G.and(ee.or(fe)), We = this.debugView, Ge = ue(
        a(500).div(D(N, a(1))),
        0,
        1
      );
      oe.assign(
        he(
          We.lessThan(0.5),
          oe,
          he(
            We.lessThan(1.5),
            se(Ge, Ge, Ge, 1),
            he(We.lessThan(2.5), b, B)
          )
        )
      );
      const mt = p.greaterThan(a(0.5)).and(E.not()).and(G);
      return S.assign(
        he(mt, O, f)
      ), A.assign(
        he(
          E,
          f,
          he(ve, te, f)
        )
      ), oe;
    })();
  }
}
class Fa {
  /** The reconstruction material. `updateFrame` writes its per-frame uniforms. */
  material;
  _historyDiv;
  /** History (reconstruction) divisor vs screen (default 2). After setting, call `resize()` then `clearHistory()`. */
  get historyDiv() {
    return this._historyDiv;
  }
  set historyDiv(e) {
    e !== this._historyDiv && (this._historyDiv = e, this.passNode.setResolutionScale(1 / e));
  }
  /** PassNode wrapping the temporal blend (MRT, two color attachments). */
  passNode;
  /** TextureNode for the blended color attachment (just-written slot). */
  outputTextureNode;
  /** Reconstructed distance attachment: `.r` is consumer depth, `.g` is carried reprojection depth. */
  hitDistTextureNode;
  _scene;
  _mesh;
  // Previous-frame copies of the two attachments; the material's history samplers
  // bind these once and never re-point.
  _historyOutput;
  _historyHitDist;
  _prevViewProjection = new u.Matrix4();
  _currentViewProjection = new u.Matrix4();
  _prevCameraPos = new u.Vector3();
  _prevQuaternion = new u.Quaternion();
  _historyIsClear = !1;
  _historyInvalidated = !1;
  /** Keep the copy-only history targets aligned with the pass MRT attachments. */
  _syncHistoryTargetSizes(e, t) {
    this._historyOutput.width === e && this._historyOutput.height === t && this._historyHitDist.width === e && this._historyHitDist.height === t || (this._historyOutput.setSize(e, t), this._historyHitDist.setSize(e, t), this._historyOutput.texture.needsUpdate = !0, this._historyHitDist.texture.needsUpdate = !0);
  }
  constructor(e, t, s, i, o, r) {
    this._historyDiv = o.historyDiv, this._scene = new u.Scene(), this._scene.name = "sky-pro:cloud-temporal", this.passNode = _s(this._scene, X.camera, { samples: 0 }), this.passNode.setResolutionScale(1 / this._historyDiv), this.passNode.setSize(s, i), this.passNode.getTextureNode("output"), this.passNode.getTextureNode("hitDistHistory");
    const h = this.passNode.getTexture("hitDistHistory");
    h.format = u.RGFormat, h.type = u.HalfFloatType, h.minFilter = u.NearestFilter, h.magFilter = u.NearestFilter, this.outputTextureNode = this.passNode.getTextureNode("output"), this.hitDistTextureNode = this.passNode.getTextureNode("hitDistHistory");
    const l = this.passNode.renderTarget.width, c = this.passNode.renderTarget.height;
    this._historyOutput = new u.RenderTarget(l, c, {
      depthBuffer: !1,
      type: u.HalfFloatType,
      format: u.RGBAFormat,
      minFilter: u.LinearFilter,
      magFilter: u.LinearFilter
    }), this._historyOutput.texture.name = "cloudTemporal:historyOutput", this._historyHitDist = new u.RenderTarget(l, c, {
      depthBuffer: !1,
      type: u.HalfFloatType,
      format: u.RGFormat,
      minFilter: u.NearestFilter,
      magFilter: u.NearestFilter
    }), this._historyHitDist.texture.name = "cloudTemporal:historyHitDist", this.material = new Ba(
      e,
      t,
      de(this._historyOutput.texture),
      de(this._historyHitDist.texture),
      r
    ), this._mesh = new u.Mesh(X.geometry(), this.material), this._scene.add(this._mesh), this.passNode.setMRT(this.material.mrtNode);
  }
  /** Width of one history attachment (post-resolution-scale). */
  get historyWidth() {
    return this.passNode.renderTarget.width;
  }
  get historyHeight() {
    return this.passNode.renderTarget.height;
  }
  /** Cache the actual march/history target sizes after a sampling-layout change. */
  setSamplingSizes(e, t, s, i) {
    this.material.sourceSize.value.set(e, t), this.material.historySize.value.set(s, i);
  }
  /** Starts/stops the resolve. `false` leaves the output target holding whatever it last drew. */
  setRenderEnabled(e) {
    this.passNode.updateBeforeType = e ? u.NodeUpdateType.FRAME : u.NodeUpdateType.NONE;
  }
  /** Reject the previous reconstruction on the next rendered frame. Repeated calls coalesce. */
  invalidateHistory() {
    this._historyInvalidated = !0;
  }
  /** Per-frame history snapshot + uniform refresh; call before this pass renders. */
  updateFrame(e, t, s, i) {
    this.material.historyValid.value = this._historyInvalidated ? 0 : 1, this._historyInvalidated = !1, this._historyIsClear = !1;
    const o = this.passNode.getTexture("output"), r = o.image;
    this._syncHistoryTargetSizes(r.width, r.height), e.copyTextureToTexture(o, this._historyOutput.texture), e.copyTextureToTexture(
      this.passNode.getTexture("hitDistHistory"),
      this._historyHitDist.texture
    ), this._currentViewProjection.copy(s).multiply(t.matrixWorldInverse);
    const h = t.position.distanceToSquared(this._prevCameraPos), l = t.quaternion.angleTo(this._prevQuaternion);
    this.material.cameraStatic.value = h < 1e-8 && l < 1e-6 ? 1 : 0;
    const c = i.freshCell;
    this.material.freshSlot.value.set(c.x, c.y), this.material.prevViewProjection.value.copy(this._prevViewProjection), this.material.cameraPos.value.copy(t.position), this.material.prevCameraPos.value.copy(this._prevCameraPos), this._prevViewProjection.copy(this._currentViewProjection), this._prevCameraPos.copy(t.position), this._prevQuaternion.copy(t.quaternion);
  }
  /** Drop accumulated history after a resize / res change (old samples sit on the wrong grid). One warm-up frame follows. */
  clearHistory(e) {
    if (this._historyIsClear) return;
    const t = e.getRenderTarget(), s = e.getClearAlpha();
    e.setClearColor(0, 0), e.setRenderTarget(this.passNode.renderTarget), e.clear(), e.setRenderTarget(this._historyOutput), e.clear(), e.setRenderTarget(this._historyHitDist), e.clear(), e.setRenderTarget(t), e.setClearColor(0, s), this._historyInvalidated = !1, this.material.historyValid.value = 1, this._historyIsClear = !0;
  }
  /** Resize the reconstruction target and its two history copies in one transaction. */
  resize(e, t, s) {
    this._historyIsClear = !1, this.passNode.setSize(e * s, t * s), this._syncHistoryTargetSizes(
      this.passNode.renderTarget.width,
      this.passNode.renderTarget.height
    );
  }
  dispose() {
    this.passNode.dispose(), this.material.dispose(), this._historyOutput.dispose(), this._historyHitDist.dispose();
  }
}
const Wa = 0.4, Ga = 1;
class Ua extends u.MeshBasicNodeMaterial {
  /** User-camera view-projection. Written each frame by `SkyRenderPipeline.updateFrame`. */
  viewProjection = g(new u.Matrix4());
  /** Cloud temporal output size in pixels. Updated when the shared sampling layout changes. */
  sourceSize = g(new u.Vector2(1, 1));
  /**
   * 1 when the camera didn't move this frame; selects the one-tap center path so the
   * converged image displays untouched without paying for silhouette filtering.
   */
  cameraStatic = g(1);
  /**
   * @param cloudColor Cloud temporal output: premultiplied HDR rgb + coverage alpha.
   * @param cloudHitDist Cloud temporal reconstructed ray-hit distance (`.r`, world meters).
   * @param rayDirOverride Per-fragment ray direction node. World space, normalized.
   * @param cameraPositionUniform `SkyPass.cameraPositionUniform`.
   * @param logarithmicDepthBuffer Whether the renderer uses logarithmic depth.
   * @param timeOfDay Time-of-day state, or `null` to compile the night steepening out.
   */
  constructor(e, t, s, i, o, r) {
    super(), this.transparent = !0, this.depthWrite = !1, this.fog = !1, this.depthTest = !0, this.blending = u.CustomBlending, this.blendEquation = u.AddEquation, this.blendSrc = u.OneFactor, this.blendDst = u.OneMinusSrcAlphaFactor, this.blendEquationAlpha = u.AddEquation, this.blendSrcAlpha = u.ZeroFactor, this.blendDstAlpha = u.OneFactor, this.vertexNode = jt(), this.colorNode = le(() => {
      const h = e.sample(Se).level(a(0)), l = se(h).toVar();
      W(this.cameraStatic.lessThanEqual(a(0.5)), () => {
        const d = z(1, 1).div(this.sourceSize).toVar(), y = e.sample(Se.add(z(0, d.y))).level(a(0)), p = e.sample(Se.sub(z(0, d.y))).level(a(0)), m = e.sample(Se.add(z(d.x, 0))).level(a(0)), S = e.sample(Se.sub(z(d.x, 0))).level(a(0)), A = e.sample(Se.add(d)).level(a(0)), H = e.sample(Se.add(z(d.x.negate(), d.y))).level(a(0)), P = e.sample(Se.add(z(d.x, d.y.negate()))).level(a(0)), v = e.sample(Se.sub(d)).level(a(0)), x = y.add(p).add(m).add(S), T = A.add(H).add(P).add(v), _ = h.mul(4).add(x.mul(2)).add(T).div(16), R = D(
          D(h.a, D(D(y.a, p.a), D(m.a, S.a))),
          D(D(A.a, H.a), D(P.a, v.a))
        ), b = pe(
          pe(h.a, pe(pe(y.a, p.a), pe(m.a, S.a))),
          pe(pe(A.a, H.a), pe(P.a, v.a))
        ), f = R.sub(b).mul(a(Ga));
        l.assign(ae(h, _, f));
      });
      const c = r ? ae(
        l.a,
        l.a.pow(a(Wa)),
        r.skyDarkness
      ) : l.a;
      return se(l.rgb, c);
    })(), this.depthNode = le(() => {
      const h = t.sample(Se).r, l = i.add(s.mul(h)), c = this.viewProjection.mul(
        se(l.x, l.y, l.z, 1)
      ), d = D(c.w, a(1e-3));
      return o ? ri(
        d.negate(),
        li,
        hi
      ).clamp(0, 1) : c.z.div(d).clamp(0, 1);
    })();
  }
}
class Xa {
  /** The composite material. `SkyRenderPipeline.updateFrame` writes its view-projection. */
  material;
  /** Fullscreen mesh. Add it to your scene. */
  mesh;
  /**
   * @param cloudColor Cloud temporal output: premultiplied HDR rgb + coverage alpha.
   * @param cloudHitDist Cloud temporal reconstructed ray-hit distance (`.r`, world meters).
   * @param rayBasis `SkyPass.rayBasis`.
   * @param cameraPositionUniform `SkyPass.cameraPositionUniform`.
   * @param logarithmicDepthBuffer Whether the renderer uses logarithmic depth.
   * @param timeOfDay When supplied, steepens cloud occlusion over the night sky.
   */
  constructor(e, t, s, i, o, r = null) {
    this.material = new Ua(
      e,
      t,
      ct(s),
      i,
      o,
      r
    ), this.mesh = new u.Mesh(X.geometry(), this.material), pt(this.mesh, dt.atmosphereOverlay), this.mesh.frustumCulled = !1;
  }
  dispose() {
    this.material.dispose();
  }
}
function Ya(n) {
  let e = [[0]];
  for (let t = 2; t <= n; t *= 2) {
    const s = t / 2, i = Array.from({ length: t }, () => Array(t));
    for (let o = 0; o < s; o += 1)
      for (let r = 0; r < s; r += 1) {
        const h = e[o][r] * 4;
        i[o][r] = h, i[o][r + s] = h + 2, i[o + s][r] = h + 3, i[o + s][r + s] = h + 1;
      }
    e = i;
  }
  return e;
}
function rs(n) {
  const e = Ya(n), t = Array.from(
    { length: n * n },
    () => ({ x: 0, y: 0 })
  );
  for (let s = 0; s < n; s += 1)
    for (let i = 0; i < n; i += 1)
      t[e[s][i]] = { x: i, y: s };
  return t;
}
const Ka = {
  2: rs(2),
  4: rs(4)
};
class qa {
  _historyDiv;
  lattice;
  _freshCell = { x: 0, y: 0 };
  _screenWidth = 1;
  _screenHeight = 1;
  _sourceWidth = 1;
  _sourceHeight = 1;
  _historyWidth = 1;
  _historyHeight = 1;
  constructor(e, t) {
    this._historyDiv = e, this.lattice = t;
  }
  get historyDiv() {
    return this._historyDiv;
  }
  /** Returns true when the layout changed. */
  setHistoryDiv(e) {
    return e === this._historyDiv ? !1 : (this._historyDiv = e, !0);
  }
  /** Raymarch divisor derived from reconstruction resolution and the mode's lattice. */
  get sourceDiv() {
    return this._historyDiv * this.lattice;
  }
  /** Frames required to refresh every position in the active lattice. */
  get period() {
    return this.lattice * this.lattice;
  }
  /** Advance the shared fresh cell once; both passes read this exact object afterward. */
  updateFrame(e) {
    const t = Ka[this.lattice], s = (e % t.length + t.length) % t.length, i = t[s];
    this._freshCell.x = i.x, this._freshCell.y = i.y;
  }
  get freshCell() {
    return this._freshCell;
  }
  /** Store the actual post-rounding target sizes after the owning passes resize. */
  setTargetSizes(e) {
    this._screenWidth = e.screenWidth, this._screenHeight = e.screenHeight, this._sourceWidth = e.sourceWidth, this._sourceHeight = e.sourceHeight, this._historyWidth = e.historyWidth, this._historyHeight = e.historyHeight;
  }
  get screenWidth() {
    return this._screenWidth;
  }
  get screenHeight() {
    return this._screenHeight;
  }
  get sourceWidth() {
    return this._sourceWidth;
  }
  get sourceHeight() {
    return this._sourceHeight;
  }
  get historyWidth() {
    return this._historyWidth;
  }
  get historyHeight() {
    return this._historyHeight;
  }
}
const Qa = new u.Color(1, 1, 1), Za = 0.8, Xs = 0.05, Ja = Xs, $a = 0.2, en = 0.5;
function tn(n, e, t) {
  const s = Math.min(1, Math.max(0, (t - n) / (e - n)));
  return s * s * (3 - 2 * s);
}
function sn(n, e, t, s) {
  const i = s.y, o = n.y.sub(i).mul(t);
  return j(
    n.x.sub(e.x.mul(o)),
    i,
    n.z.sub(e.z.mul(o))
  );
}
function an(n, e) {
  const t = n.sub(e.center), s = Ne(Z(t, e.axisU)).div(e.extent), i = Ne(Z(t, e.axisV)).div(e.extent), o = D(s, i);
  return ue(
    a(1).sub(ye(a(Za), a(1), o)),
    a(0),
    a(1)
  );
}
class nn {
  /** 1 = on, 0 = off; multiplied into the shafts so it fades cleanly. */
  enabledUniform = g(1);
  /** 1 when the active source is above the horizon, else 0. */
  sourceAboveHorizon = g(1);
  /** Shaft tint — active light's color (sun, or desaturated moon at night). */
  activeColor = g(new u.Color(1, 1, 1));
  /** Per-source brightness: sun = 1, moon = `moonGodRayScale`, times the grazing-elevation
   *  fade (see GRAZING_FADE_START/END) so shafts ease out approaching the horizon. */
  sourceScale = g(1);
  /** World-space active-light direction; drives the HG phase peaking shafts toward it. */
  activeDir = g(new u.Vector3(0, 1, 0));
  /** 1 / max(activeDir.y, MIN_SUN_ELEVATION_SIN), precomputed each frame so the per-step
   *  shadow-plane projection is a multiply instead of a max()+division. */
  activeInvSunY = g(1);
  /** Sun elevation (radians) below which the active light switches to the moon. -6° matches the night gate. */
  nightThreshold = -6 * Math.PI / 180;
  _sun;
  _godRays;
  _atmosphere;
  _timeOfDay;
  // Baked cloud shadow map (`texture()` node) + its top-down projection.
  _shadowTexNode;
  _shadowProjection;
  // Camera world position (owned by SkyPass) — the march's ray origin.
  _cameraPos;
  // Cloud temporal output (premultiplied rgb + coverage alpha) and its ray-hit
  // distance; together they bound the march where cloud covers the pixel.
  _cloudColor;
  _cloudHitDist;
  /** Half-resolution shaft target created when the post graph calls {@link applyTo}. */
  _shaftTarget = null;
  _shaftTargetActive = !0;
  _moonColorScratch = new u.Color();
  constructor(e, t, s, i, o, r, h, l, c = null) {
    this._sun = e, this._godRays = t, this._atmosphere = s, this._timeOfDay = c, this._shadowTexNode = de(i), this._shadowProjection = o, this._cameraPos = r, this._cloudColor = h, this._cloudHitDist = l;
  }
  updateUniforms() {
    this.enabledUniform.value = this._godRays.enabled ? 1 : 0;
    const e = this._sun.direction.value, t = Math.asin(Math.max(-1, Math.min(1, e.y))), s = !this._timeOfDay || t >= this.nightThreshold;
    let i, o, r;
    s ? (i = e, o = this._sun.color.value, r = 1) : (i = this._timeOfDay.moonDirection.value, o = this._moonColorScratch.copy(this._timeOfDay.moonColor.value).lerp(Qa, 0.3), r = this._godRays.moonGodRayScale), this.activeColor.value.copy(o), this.activeDir.value.copy(i);
    const h = tn(Ja, $a, i.y);
    this.sourceScale.value = r * h, this.activeInvSunY.value = 1 / Math.max(i.y, Xs), this.sourceAboveHorizon.value = i.y > 0 ? 1 : 0;
    const l = this._godRays.enabled && i.y > 0 && this.sourceScale.value > 0;
    this._shaftTarget && (this._shaftTarget.autoUpdate = l, l !== this._shaftTargetActive && (this._shaftTarget.textureNeedsUpdate = !0)), this._shaftTargetActive = l;
  }
  /**
   * TSL node: additive in-scattered shaft radiance (linear), marching camera→`sceneDist`
   * (clamped to `maxDistance`).
   */
  overlayNode(e, t) {
    const s = this._atmosphere, i = this._godRays, o = this._cameraPos, r = this.activeColor, h = this.sourceScale, l = this.activeDir, c = this.activeInvSunY, d = this.enabledUniform, y = this.sourceAboveHorizon, p = this._shadowTexNode, m = this._shadowProjection;
    return le(() => {
      const S = pe(t, i.maxDistance).toVar(), A = j(0).toVar();
      return W(d.mul(y).greaterThan(a(0.5)), () => {
        const P = Ht(
          Z(e, l),
          s.mieDirectionalG
        ).toVar(), v = S.div(i.steps).toVar(), x = Os.xy, T = Ke(
          a(52.9829189).mul(
            Ke(x.x.mul(0.06711056).add(x.y.mul(583715e-8)))
          )
        ).toVar(), _ = re(i.extinction.mul(v).negate()).toVar(), R = a(1).sub(_).toVar(), b = j(r).mul(h).mul(P).toVar(), f = a(1).toVar();
        ke(i.steps, ({ i: w }) => {
          const O = a(w).add(T).mul(v), k = o.add(e.mul(O)).toVar(), C = sn(k, l, c, m.center), N = Ds(
            ue(Rs(C, p, m), a(0), a(1)),
            i.sharpness
          ), V = b.mul(N).mul(an(C, m));
          A.addAssign(f.mul(V).mul(R)), f.mulAssign(_);
        });
      }), j(1).sub(re(A.mul(i.strength).negate()));
    })();
  }
  /**
   * March end (world meters): camera→scene hit, pulled in to the cloud's hit distance where
   * cloud covers the pixel. Blending by cloud alpha rather than masking the finished shaft
   * keeps haze between camera and cloud glowing while occluding only the path behind it, and
   * lets a thin edge pass the shaft through. Cloud-ray misses carry the far miss sentinel
   * (rendering/hitDistance.ts), gated off by the `step`.
   */
  shaftEnd(e) {
    const t = this._cloudColor.sample(Se).a, s = this._cloudHitDist.sample(Se).r, i = lt(s, e);
    return ae(e, s, t.mul(i));
  }
  /**
   * Post-chain convenience: `sceneColor + shaftInScatter`; splice into the outputNode graph in linear space.
   * @param viewDir per-pixel world-space view ray, from the caller's own depth reconstruction.
   * @param sceneDist camera-to-scene-hit distance (world meters); sky pixels naturally clamp
   *   the march to `maxDistance` since their reconstructed distance is at/near the far plane.
   */
  applyTo(e, t, s) {
    this._shaftTarget?.renderTarget?.dispose();
    const i = this.overlayNode(t, this.shaftEnd(s));
    return i.name = "God Rays", this._shaftTarget = ui(i, null, null, {
      type: u.HalfFloatType,
      depthBuffer: !1
    }).setResolutionScale(en), this._shaftTarget.value.name = "godRays", this._shaftTarget.value.minFilter = u.LinearFilter, this._shaftTarget.value.magFilter = u.LinearFilter, this._shaftTarget.autoUpdate = this._shaftTargetActive, e.add(this._shaftTarget.sample(Se).rgb);
  }
  dispose() {
    this._shaftTarget?.renderTarget?.dispose(), this._shaftTarget = null;
  }
}
class on {
  target;
  texture;
  /** World point the map is centered on (camera XZ at the ground altitude). */
  center = g(new u.Vector3(0, 0, 0));
  /** Map U axis — world +X. */
  axisU = g(new u.Vector3(1, 0, 0));
  /** Map V axis — world +Z. */
  axisV = g(new u.Vector3(0, 0, 1));
  /** Half-width of the world-XZ footprint in meters. */
  extent = g(4e3);
  /** Shadow strength (0 = no shadow, 1 = full). Consumed by `cloudShadowFactor`. */
  intensity = g(1);
  /** Master enable as a shader uniform (1 = on, 0 = off) for `cloudShadowFactor`. */
  enabledUniform = g(1);
  /** Sun-transmittance march step count through the shell. Step length adapts to the in-shell segment. */
  lightSteps = g(8);
  /** Absolute mip level for every noise tap (0 = full detail); raising it softens + cheapens the bake. */
  mipLevel = g(0);
  /** Virtual planet center `(camX, -PLANET_RADIUS, camZ)`, tracked per frame. */
  planetCenter = g(new u.Vector3(0, -Te, 0));
  /** Active light direction the bake marches toward — sun by day, moon below `nightThreshold`. */
  lightDir = g(new u.Vector3(0, 1, 0));
  /** Re-bake cadence (frames). */
  bakeInterval;
  /** Sun elevation (radians) below which the bake follows the moon. Keep in sync with `GodRaysPass.nightThreshold`. */
  nightThreshold = -6 * Math.PI / 180;
  _groundReferenceY;
  _cloud;
  _sun;
  _timeOfDay;
  _animatedClouds;
  _weatherTexture;
  _baseShapeTexture;
  _material;
  _scene;
  _frame = 0;
  _enabled = !0;
  _dirty = !0;
  _lastDensityRevision = -1;
  _lastCameraX = Number.NaN;
  _lastCameraZ = Number.NaN;
  _lastLightDir = new u.Vector3(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  _lastLightSteps = Number.NaN;
  _lastMipLevel = Number.NaN;
  _lastExtent = Number.NaN;
  _lastWeatherTextureVersion = -1;
  _lastBaseShapeTextureVersion = -1;
  constructor(e) {
    this._groundReferenceY = e.groundReferenceY ?? 0, this._cloud = e.cloud, this._sun = e.sun, this._timeOfDay = e.timeOfDay ?? null, this._animatedClouds = e.animatedClouds, this.lightDir.value.copy(e.sun.direction.value), this._weatherTexture = e.weatherTexture, this._baseShapeTexture = e.baseShapeTexture, this.extent.value = e.extent ?? 4e3, this.bakeInterval = Math.max(1, Math.round(e.bakeInterval ?? 1));
    const t = e.resolution ?? 512;
    this.target = new u.RenderTarget(t, t, {
      type: u.HalfFloatType,
      format: u.RedFormat,
      depthBuffer: !1,
      magFilter: u.LinearFilter,
      minFilter: u.LinearFilter,
      wrapS: u.ClampToEdgeWrapping,
      wrapT: u.ClampToEdgeWrapping
    }), this.target.texture.name = "cloudShadowMap", this.texture = this.target.texture, this._material = new u.MeshBasicNodeMaterial(), this._material.depthTest = !1, this._material.depthWrite = !1, this._material.colorNode = this._buildColorNode();
    const s = X.makeScene(this._material);
    s.scene.name = "sky-pro:cloud-shadow", this._scene = s.scene;
  }
  /** The world-XZ projection uniforms, for `cloudShadowFactor`. */
  get projection() {
    return {
      center: this.center,
      axisU: this.axisU,
      axisV: this.axisV,
      extent: this.extent,
      intensity: this.intensity,
      enabled: this.enabledUniform
    };
  }
  /** Current shadow-map resolution (square). */
  get resolution() {
    return this.target.width;
  }
  /** Resize the map; keeps the texture object, so the sampler node stays valid. */
  setResolution(e) {
    const t = Math.max(64, Math.round(e));
    t !== this.target.width && (this.target.setSize(t, t), this._dirty = !0);
  }
  /** Master enable. `false` skips the bake and drives the `enabled` uniform so receivers read full sun. */
  get enabled() {
    return this._enabled;
  }
  set enabled(e) {
    e !== this._enabled && (this._enabled = e, this.enabledUniform.value = e ? 1 : 0, e && (this._dirty = !0));
  }
  /** Swap the base-shape noise texture and recompile; mirrors `CloudMaterial.setNoiseTextures`. */
  setNoiseTextures(e) {
    let t = !1;
    e.baseShape && e.baseShape !== this._baseShapeTexture && (this._baseShapeTexture = e.baseShape, t = !0), e.weather && e.weather !== this._weatherTexture && (this._weatherTexture = e.weather, t = !0), t && (this._material.colorNode = this._buildColorNode(), this._material.needsUpdate = !0, this._dirty = !0);
  }
  /** Refresh the projection from the camera (centers on camera XZ) and pick the active light; call once per frame before `bake()`. */
  updateFrame(e, t) {
    const s = e.position.x, i = e.position.z;
    this.center.value.set(s, this._groundReferenceY, i), this.planetCenter.value.set(s, -Te, i);
    const o = this._sun.direction.value, r = Math.asin(Math.max(-1, Math.min(1, o.y))), l = !this._timeOfDay || r >= this.nightThreshold ? o : this._timeOfDay.moonDirection.value;
    (t !== this._lastDensityRevision || !Object.is(s, this._lastCameraX) || !Object.is(i, this._lastCameraZ) || !l.equals(this._lastLightDir) || !Object.is(this.lightSteps.value, this._lastLightSteps) || !Object.is(this.mipLevel.value, this._lastMipLevel) || !Object.is(this.extent.value, this._lastExtent) || this._weatherTexture.version !== this._lastWeatherTextureVersion || this._baseShapeTexture.version !== this._lastBaseShapeTextureVersion) && (this._dirty = !0), this.lightDir.value.copy(l), this._lastDensityRevision = t, this._lastCameraX = s, this._lastCameraZ = i, this._lastLightDir.copy(l), this._lastLightSteps = this.lightSteps.value, this._lastMipLevel = this.mipLevel.value, this._lastExtent = this.extent.value, this._lastWeatherTextureVersion = this._weatherTexture.version, this._lastBaseShapeTextureVersion = this._baseShapeTexture.version;
  }
  /** Bake a dirty shadow map on its configured cadence. */
  bake(e) {
    if (!this._enabled) return;
    const t = this._frame % this.bakeInterval === 0;
    if (this._frame++, !this._dirty || !t) return;
    const s = e.getRenderTarget(), i = e.autoClear;
    e.autoClear = !0, e.setRenderTarget(this.target), e.render(this._scene, X.camera), e.setRenderTarget(s), e.autoClear = i, this._dirty = !1;
  }
  dispose() {
    this.target.dispose(), this._material.dispose();
  }
  _buildColorNode() {
    const e = this._cloud.shape, t = this._cloud.wind, s = this.lightDir, i = this.planetCenter, o = a(Te), r = this.lightSteps, h = this.mipLevel, l = this.projection, c = de(this._weatherTexture), d = Ps(this._baseShapeTexture), y = [
      a(Le.r),
      a(Le.g),
      a(Le.b)
    ], p = [
      a(Ie.r),
      a(Ie.g),
      a(Ie.b)
    ], m = e.baseScale.mul(e.erosionScaleBaseMultiplier);
    return le(() => {
      const S = o.add(e.altitude), A = S.add(e.thickness), H = ge().mul(2).sub(1).mul(l.extent), P = l.center.add(l.axisU.mul(H.x)).add(l.axisV.mul(H.y)).toVar(), v = D(
        Ee(P, s, i, S).y,
        a(0)
      ).toVar(), x = D(
        Ee(P, s, i, A).y,
        a(0)
      ).toVar(), T = a(1).toVar();
      return W(
        s.y.greaterThan(a(0)).and(x.greaterThan(v.add(a(1)))),
        () => {
          const _ = x.sub(v).div(r).toVar(), R = a(0).toVar(), b = v.add(_.mul(0.5)).toVar();
          ke(r, () => {
            const f = P.add(s.mul(b)).toVar(), w = f.x.sub(i.x), O = f.z.sub(i.z), k = w.mul(w).add(O.mul(O)), C = f.y.sub(e.altitude).add(k.div(o.mul(2))).div(e.thickness).toVar(), N = Fs({
              position: f,
              shellHeightFraction: C,
              weather: c,
              base: d,
              animatedClouds: this._animatedClouds,
              coverage: e.coverage,
              // Same live wind/evolution uniforms the primary march uses.
              windOffset: t.offset,
              windDirection: t.direction,
              windSkew: t.skew,
              evolutionOffset: t.evolutionOffset,
              weatherScale: e.weatherScale,
              baseScale: e.baseScale,
              erosionScale: m,
              baseChannelStrengths: y,
              baseStrength: e.baseStrength,
              erosionChannelStrengths: p,
              erosionStrengthBase: e.erosionStrengthBase,
              erosionStrengthPeak: e.erosionStrengthPeak,
              erosionShape: e.erosionShape,
              baseWeatherStrength: e.baseWeatherStrength,
              baseWeatherHeightStart: e.baseWeatherHeightStart,
              baseWeatherHeightEnd: e.baseWeatherHeightEnd,
              edgeSoftness: e.edgeSoftness,
              edgeSoftnessFalloff: e.edgeSoftnessFalloff,
              thickness: e.thickness,
              // Every 3D noise tap reads `mipLevel` (mip 0 = full detail); weather has no mip pyramid.
              lods: {
                base: h,
                erosion: h
              }
            });
            R.addAssign(N.mul(e.density).mul(_)), b.addAssign(_);
          }), T.assign(re(R.negate()));
        }
      ), se(T, T, T, a(1));
    })();
  }
}
const rn = 256, ln = 64, ls = 32, ft = ie.ATMOSPHERE_THICKNESS_KM, hs = 40, us = 64, cs = 20, hn = 2.399963229728653, De = a(ie.EARTH_R_KM), tt = a(ie.ATMO_R_KM), ds = a(ie.RAYLEIGH_SCALE_HEIGHT_KM), ps = a(ie.MIE_SCALE_HEIGHT_KM), ms = j(...ie.RAYLEIGH_BETA_RGB_KM), gs = a(ie.MIE_BETA_BASE_KM), ys = a(ie.MIE_EXTINCTION_FACTOR);
class un {
  /** Transmittance LUT target. */
  target;
  /** Transmittance LUT texture, sampled by the sky, fog, and cloud lighting. */
  texture;
  /** Multiple-scattering LUT target. */
  multiScatterTarget;
  /** Multiple-scattering LUT texture, sampled alongside {@link texture}. */
  multiScatterTexture;
  _atmosphere;
  _material;
  _scene;
  _msMaterial;
  _msScene;
  _lastBakedRayleigh = Number.NaN;
  _lastBakedTurbidity = Number.NaN;
  _lastBakedGroundAlbedo = new u.Color(Number.NaN, Number.NaN, Number.NaN);
  _needsBake = !0;
  constructor(e) {
    this._atmosphere = e, this.target = new u.RenderTarget(
      rn,
      ln,
      {
        type: u.HalfFloatType,
        format: u.RGBAFormat,
        depthBuffer: !1,
        magFilter: u.LinearFilter,
        minFilter: u.LinearFilter,
        wrapS: u.ClampToEdgeWrapping,
        wrapT: u.ClampToEdgeWrapping
      }
    ), this.target.texture.name = "transmittanceLUT", this.texture = this.target.texture, this.multiScatterTarget = new u.RenderTarget(
      ls,
      ls,
      {
        type: u.HalfFloatType,
        format: u.RGBAFormat,
        depthBuffer: !1,
        magFilter: u.LinearFilter,
        minFilter: u.LinearFilter,
        wrapS: u.ClampToEdgeWrapping,
        wrapT: u.ClampToEdgeWrapping
      }
    ), this.multiScatterTarget.texture.name = "multiScatterLUT", this.multiScatterTexture = this.multiScatterTarget.texture, this._material = new u.MeshBasicNodeMaterial(), this._material.depthTest = !1, this._material.depthWrite = !1, this._material.colorNode = this._buildTransmittanceColorNode();
    const t = X.makeScene(this._material);
    t.scene.name = "sky-pro:transmittance-lut", this._scene = t.scene, this._msMaterial = new u.MeshBasicNodeMaterial(), this._msMaterial.depthTest = !1, this._msMaterial.depthWrite = !1, this._msMaterial.colorNode = this._buildMultiScatterColorNode();
    const s = X.makeScene(this._msMaterial);
    s.scene.name = "sky-pro:multi-scatter-lut", this._msScene = s.scene;
  }
  /** Call once per frame before the sky pass. Cheap no-op when not dirty. */
  update(e) {
    const t = this._atmosphere.rayleigh.value, s = this._atmosphere.turbidity.value, i = this._atmosphere.groundAlbedo.value, o = this._needsBake || t !== this._lastBakedRayleigh || s !== this._lastBakedTurbidity;
    (o || !i.equals(this._lastBakedGroundAlbedo)) && (this._bake(e, o), this._lastBakedRayleigh = t, this._lastBakedTurbidity = s, this._lastBakedGroundAlbedo.copy(i), this._needsBake = !1);
  }
  dispose() {
    this.target.dispose(), this.multiScatterTarget.dispose(), this._material.dispose(), this._msMaterial.dispose();
  }
  _bake(e, t) {
    const s = e.getRenderTarget(), i = e.autoClear;
    e.autoClear = !0, t && (e.setRenderTarget(this.target), e.clear(), e.render(this._scene, X.camera)), e.setRenderTarget(this.multiScatterTarget), e.clear(), e.render(this._msScene, X.camera), e.setRenderTarget(s), e.autoClear = i;
  }
  _buildTransmittanceColorNode() {
    const e = this._atmosphere.rayleigh, t = this._atmosphere.turbidity;
    return le(() => {
      const s = ms.mul(e), i = gs.mul(t), o = j(i, i, i), r = ge(), h = r.x.mul(a(2)).sub(a(1)), l = r.y.mul(a(ft)), c = De.add(l), d = j(a(0), c, a(0)), y = me(D(a(1).sub(h.mul(h)), a(0))), p = j(y, h, a(0)), m = a(2).mul(Z(d, p)), S = Z(d, d).sub(tt.mul(tt)), A = D(m.mul(m).sub(a(4).mul(S)), a(0)), P = D(
        m.negate().add(me(A)).div(a(2)),
        a(0)
      ).div(a(hs)), v = a(0).toVar(), x = a(0).toVar();
      ke(hs, ({ i: k }) => {
        const C = a(k).add(a(0.5)).mul(P), N = d.add(p.mul(C)), V = D(Oe(N).sub(De), a(0));
        v.addAssign(re(V.negate().div(ds)).mul(P)), x.addAssign(re(V.negate().div(ps)).mul(P));
      });
      const T = s.mul(v).add(o.mul(ys).mul(x)), _ = a(2).mul(Z(d, p)), R = Z(d, d).sub(De.mul(De)), b = _.mul(_).sub(a(4).mul(R)), f = _.negate().sub(me(D(b, a(0)))).div(a(2)), w = b.greaterThan(a(0)).and(f.greaterThan(a(0))), O = he(w, j(0, 0, 0), re(T.negate()));
      return se(O, a(1));
    })();
  }
  /** Multiple-scattering LUT integrand: second-order in-scatter times an energy-conserving boost 1/(1−f), where f is the fraction re-scattered per bounce. */
  _buildMultiScatterColorNode() {
    const e = this._atmosphere.rayleigh, t = this._atmosphere.turbidity, s = this._atmosphere.groundAlbedo, i = this.target.texture;
    return le(() => {
      const o = ms.mul(e), r = gs.mul(t), h = j(r, r, r), l = a(1).div(a(4).mul(xe)), c = ge(), d = c.x.mul(a(2)).sub(a(1)), y = c.y.mul(a(ft)), p = De.add(y), m = j(a(0), p, a(0)), S = me(D(a(1).sub(d.mul(d)), a(0))), A = j(S, d, a(0)), H = j(0, 0, 0).toVar(), P = j(0, 0, 0).toVar(), v = a(us);
      ke(us, ({ i: b }) => {
        const f = a(1).sub(a(2).mul(a(b).add(0.5)).div(v)), w = a(b).mul(a(hn)), O = me(D(a(1).sub(f.mul(f)), a(0))), k = j(O.mul(ot(w)), f, O.mul(rt(w))), C = a(2).mul(Z(m, k)), N = Z(m, m).sub(tt.mul(tt)), V = C.negate().add(me(D(C.mul(C).sub(a(4).mul(N)), a(0)))).div(a(2)), U = Z(m, m).sub(De.mul(De)), L = C.mul(C).sub(a(4).mul(U)), Y = V.toVar(), I = a(0).toVar();
        W(L.greaterThan(a(0)), () => {
          const Q = C.negate().sub(me(D(L, a(0)))).div(a(2));
          W(Q.greaterThan(a(0)), () => {
            Y.assign(pe(Q, V)), I.assign(a(1));
          });
        });
        const E = Y.div(a(cs)), F = j(1, 1, 1).toVar(), K = j(0, 0, 0).toVar(), ee = j(0, 0, 0).toVar();
        ke(cs, ({ i: Q }) => {
          const te = a(Q).add(a(0.5)).mul(E), q = m.add(k.mul(te)), G = Oe(q), B = D(G.sub(De), a(0)), J = re(B.negate().div(ds)), $ = re(B.negate().div(ps)), ne = o.mul(J).add(h.mul($)), ce = o.mul(J).add(h.mul(ys).mul($)), oe = re(ce.negate().mul(E)), fe = Z(q, A).div(G), ve = de(i, z(fe.mul(0.5).add(0.5), B.div(a(ft)))).rgb;
          K.addAssign(F.mul(ne).mul(ve).mul(l).mul(E)), ee.addAssign(F.mul(ne).mul(E)), F.mulAssign(oe);
        }), W(I.greaterThan(a(0.5)), () => {
          const Q = m.add(k.mul(Y)), te = be(Q), q = Z(te, A), G = de(i, z(q.mul(0.5).add(0.5), a(0))).rgb, B = D(q, a(0));
          K.addAssign(
            F.mul(s).mul(a(1).div(xe)).mul(B).mul(G)
          );
        }), H.addAssign(K), P.addAssign(ee);
      });
      const x = H.div(v), T = pe(P.div(v), j(0.999, 0.999, 0.999)), _ = j(1, 1, 1).div(j(1, 1, 1).sub(T)), R = x.mul(_);
      return se(R, a(1));
    })();
  }
}
const cn = 200, dn = 100;
class pn {
  target;
  texture;
  _atmosphere;
  _sun;
  _material;
  _scene;
  _lastSunY = Number.NaN;
  _lastRayleigh = Number.NaN;
  _lastTurbidity = Number.NaN;
  _lastMieG = Number.NaN;
  _lastMieStrength = Number.NaN;
  _lastSkyMultipleScattering = Number.NaN;
  _lastGroundAlbedo = new u.Color(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  constructor(e, t, s, i) {
    this._atmosphere = e, this._sun = t, this.target = new u.RenderTarget(
      cn,
      dn,
      {
        type: u.HalfFloatType,
        format: u.RGBAFormat,
        depthBuffer: !1,
        magFilter: u.LinearFilter,
        minFilter: u.LinearFilter,
        wrapS: u.ClampToEdgeWrapping,
        wrapT: u.ClampToEdgeWrapping
      }
    ), this.target.texture.name = "skyViewLUT", this.texture = this.target.texture;
    const o = qe(
      s,
      i
    );
    this._material = new u.MeshBasicNodeMaterial(), this._material.depthTest = !1, this._material.depthWrite = !1, this._material.colorNode = le(() => {
      const h = z(ge().x, ge().y.oneMinus()), l = h.x.mul(h.x).mul(xe), c = h.y.mul(h.y), d = me(D(a(1).sub(c.mul(c)), 0)), y = j(
        d.mul(ot(l)),
        c,
        d.mul(rt(l))
      ), p = ue(this._sun.direction.y, a(-1), a(1)), m = me(D(a(1).sub(p.mul(p)), 0)), S = j(m, p, a(0)), A = o(
        y,
        S,
        this._atmosphere.turbidity,
        this._atmosphere.mieDirectionalG,
        this._atmosphere.skyMultipleScattering,
        this._atmosphere.mieScatteringStrength,
        this._atmosphere.rayleigh
      );
      return se(A, a(1));
    })();
    const r = X.makeScene(this._material);
    r.scene.name = "sky-pro:sky-view-lut", this._scene = r.scene;
  }
  /** Bake when sun elevation or any radiance-producing atmosphere input changes. */
  update(e) {
    const t = this._atmosphere, s = this._sun.direction.value.y, i = t.groundAlbedo.value;
    if (!(s !== this._lastSunY || t.rayleigh.value !== this._lastRayleigh || t.turbidity.value !== this._lastTurbidity || t.mieDirectionalG.value !== this._lastMieG || t.mieScatteringStrength.value !== this._lastMieStrength || t.skyMultipleScattering.value !== this._lastSkyMultipleScattering || !i.equals(this._lastGroundAlbedo))) return;
    const r = e.getRenderTarget(), h = e.autoClear;
    e.autoClear = !0, e.setRenderTarget(this.target), e.clear(), e.render(this._scene, X.camera), e.setRenderTarget(r), e.autoClear = h, this._lastSunY = s, this._lastRayleigh = t.rayleigh.value, this._lastTurbidity = t.turbidity.value, this._lastMieG = t.mieDirectionalG.value, this._lastMieStrength = t.mieScatteringStrength.value, this._lastSkyMultipleScattering = t.skyMultipleScattering.value, this._lastGroundAlbedo.copy(i);
  }
  dispose() {
    this.target.dispose(), this._material.dispose();
  }
}
class mn extends u.PassNode {
  _fixedWidth;
  _fixedHeight;
  _renderRequested = !0;
  constructor(e, t, s, i, o) {
    super(u.PassNode.COLOR, e, t, o), this._fixedWidth = s, this._fixedHeight = i, super.setSize(s, i);
  }
  requestRender() {
    this._renderRequested = !0;
  }
  setSize(e, t) {
    super.setSize(this._fixedWidth, this._fixedHeight);
  }
  updateBefore(e) {
    if (!this._renderRequested) return;
    const t = super.updateBefore(e);
    return this._renderRequested = !1, t;
  }
}
const gn = 2e3;
class yn {
  target;
  /** Pass texture nodes carry the dependency that renders a dirty atlas before cloud sampling. */
  inscatterTexture;
  transmittanceTexture;
  _atmosphere;
  _sun;
  _clouds;
  _rayBasis = new Cs();
  _maxDistanceKm = g(42);
  _material;
  _scene;
  _passNode;
  _lastCameraQuaternion = new u.Quaternion(
    Number.NaN,
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  _lastFov = Number.NaN;
  _lastAspect = Number.NaN;
  _lastSunDirection = new u.Vector3(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  _lastRayleigh = Number.NaN;
  _lastTurbidity = Number.NaN;
  _lastMieG = Number.NaN;
  _lastMieStrength = Number.NaN;
  _lastSkyMultipleScattering = Number.NaN;
  _lastHazeDensityScale = Number.NaN;
  _lastMaxDistanceMeters = Number.NaN;
  _lastGroundAlbedo = new u.Color(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  constructor(e, t, s, i, o) {
    this._atmosphere = e, this._sun = t, this._clouds = s;
    const r = {
      type: u.HalfFloatType,
      format: u.RGBAFormat,
      depthBuffer: !1,
      magFilter: u.LinearFilter,
      minFilter: u.LinearFilter,
      wrapS: u.ClampToEdgeWrapping,
      wrapT: u.ClampToEdgeWrapping
    }, h = zs(
      i,
      o
    );
    this._material = new u.MeshBasicNodeMaterial(), this._material.depthTest = !1, this._material.depthWrite = !1, this._material.blending = u.NoBlending;
    const l = ht(
      "vec4",
      "aerialPerspectiveTransmittanceOutput"
    );
    this._material.colorNode = le(() => {
      const d = ze(ge().x.mul(je)), y = z(Ke(ge().x.mul(je)), ge().y), p = kt(this._rayBasis, y), m = d.add(0.5).div(je), S = m.mul(m).mul(this._maxDistanceKm), A = h({
        viewDir: p,
        sunDir: this._sun.direction,
        turbidity: this._atmosphere.turbidity,
        mieG: this._atmosphere.mieDirectionalG,
        rayleigh: this._atmosphere.rayleigh,
        skyMultipleScattering: this._atmosphere.skyMultipleScattering,
        mieScatteringStrength: this._atmosphere.mieScatteringStrength,
        maxDist: S,
        densityScale: this._clouds.fade.hazeDensityScale
      });
      return l.assign(se(A.transmittance, 1)), se(A.inscatter, 1);
    })(), this._material.mrtNode = Ct({
      output: Nt,
      aerialTransmittance: l
    });
    const c = X.makeScene(this._material);
    c.scene.name = "sky-pro:aerial-perspective-froxel", this._scene = c.scene, this._passNode = new mn(
      this._scene,
      X.camera,
      Bs,
      at,
      r
    ), this._passNode.setMRT(this._material.mrtNode), this.target = this._passNode.renderTarget, this.inscatterTexture = this._passNode.getTextureNode("output"), this.transmittanceTexture = this._passNode.getTextureNode("aerialTransmittance"), this.target.textures[0].name = "output", this.target.textures[1].name = "aerialTransmittance";
  }
  /** Bake when the camera frame or any atmosphere input changes; static views reuse it. */
  update(e) {
    e.updateMatrixWorld(), e.getWorldQuaternion(At);
    const t = this._atmosphere, s = this._sun.direction.value, i = t.groundAlbedo.value, o = this._clouds.fade.horizonMeltEnd.value + gn;
    (!At.equals(this._lastCameraQuaternion) || e.fov !== this._lastFov || e.aspect !== this._lastAspect || !s.equals(this._lastSunDirection) || t.rayleigh.value !== this._lastRayleigh || t.turbidity.value !== this._lastTurbidity || t.mieDirectionalG.value !== this._lastMieG || t.mieScatteringStrength.value !== this._lastMieStrength || t.skyMultipleScattering.value !== this._lastSkyMultipleScattering || this._clouds.fade.hazeDensityScale.value !== this._lastHazeDensityScale || o !== this._lastMaxDistanceMeters || !i.equals(this._lastGroundAlbedo)) && (this._rayBasis.update(e), this._maxDistanceKm.value = Math.max(1e-3, o * 1e-3), this._passNode.requestRender(), this._lastCameraQuaternion.copy(At), this._lastFov = e.fov, this._lastAspect = e.aspect, this._lastSunDirection.copy(s), this._lastRayleigh = t.rayleigh.value, this._lastTurbidity = t.turbidity.value, this._lastMieG = t.mieDirectionalG.value, this._lastMieStrength = t.mieScatteringStrength.value, this._lastSkyMultipleScattering = t.skyMultipleScattering.value, this._lastHazeDensityScale = this._clouds.fade.hazeDensityScale.value, this._lastMaxDistanceMeters = o, this._lastGroundAlbedo.copy(i));
  }
  dispose() {
    this._passNode.dispose(), this._material.dispose();
  }
}
const At = new u.Quaternion(), Sn = 1e-5;
class vn {
  /** Zenith diffuse-fill radiance, linear RGB. Pre-multiplied by sunIntensity. */
  zenithRadiance = g(new M.Vector3(0, 0, 0));
  /** Toward-sun horizon diffuse-fill radiance, linear RGB. Pre-multiplied by sunIntensity. */
  horizonRadiance = g(new M.Vector3(0, 0, 0));
  /**
   * Ground-bounce upwelling fill on the cloud base, linear RGB. Pre-multiplied by
   * sunIntensity. Driven by the cloud's own ground albedo, not the atmosphere's.
   */
  groundBounceRadiance = g(new M.Vector3(0, 0, 0));
  /** Per-channel sun tint at ground level, [0,1]. NOT pre-multiplied by sunIntensity. */
  sunTransmittance = g(new M.Vector3(1, 1, 1));
  // Cache keys — bake skipped when none change.
  _lastRayleigh = Number.NaN;
  _lastTurbidity = Number.NaN;
  _lastMultipleScattering = Number.NaN;
  _lastSunIntensity = Number.NaN;
  _lastGroundBounceAlbedo = new M.Color(Number.NaN, Number.NaN, Number.NaN);
  _lastSunDir = new M.Vector3(Number.NaN, Number.NaN, Number.NaN);
  // Scratch vectors reused inside the integrand.
  _scratchView = new M.Vector3();
  _scratchHorizonDir = new M.Vector3();
  _scratchOut = new M.Vector3();
  _scratchSkyDiffuse = new M.Vector3();
  /** Recompute the ambient terms if any input changed. Call once per frame. */
  update(e, t, s) {
    const i = e.rayleigh.value, o = e.turbidity.value, r = e.multipleScattering.value, h = s.groundBounceAlbedo.value, l = t.intensity.value, c = t.direction.value, d = c.dot(this._lastSunDir) > 1 - Sn;
    if (i === this._lastRayleigh && o === this._lastTurbidity && r === this._lastMultipleScattering && l === this._lastSunIntensity && h.equals(this._lastGroundBounceAlbedo) && d)
      return;
    this._scratchView.set(0, 1, 0), Rt(
      this._scratchView,
      c,
      o,
      r,
      i,
      this._scratchOut
    ), this.zenithRadiance.value.copy(this._scratchOut).multiplyScalar(l), this._scratchHorizonDir.set(c.x, 0.12, c.z);
    const y = this._scratchHorizonDir.length();
    y > 0 && this._scratchHorizonDir.divideScalar(y), Rt(
      this._scratchHorizonDir,
      c,
      o,
      r,
      i,
      this._scratchOut
    ), this.horizonRadiance.value.copy(this._scratchOut).multiplyScalar(l), fn(c, o, i, this._scratchOut), this.sunTransmittance.value.copy(this._scratchOut);
    const p = Math.max(c.y, 0);
    An(c, o, r, i, this._scratchSkyDiffuse);
    const m = this.sunTransmittance.value, S = this._scratchSkyDiffuse, A = p / Math.PI;
    this.groundBounceRadiance.value.set(
      h.r * l * (S.x + m.x * A),
      h.g * l * (S.y + m.y * A),
      h.b * l * (S.z + m.z * A)
    ), this._lastRayleigh = i, this._lastTurbidity = o, this._lastMultipleScattering = r, this._lastSunIntensity = l, this._lastGroundBounceAlbedo.copy(h), this._lastSunDir.copy(c);
  }
}
const Fe = ie.EARTH_R_KM, Ve = ie.ATMO_R_KM, Ot = ie.RAYLEIGH_SCALE_HEIGHT_KM, _t = ie.MIE_SCALE_HEIGHT_KM, [Ys, Ks, qs] = ie.RAYLEIGH_BETA_RGB_KM, Qs = ie.MIE_BETA_BASE_KM, Be = ie.MIE_EXTINCTION_FACTOR, bt = 1 / (4 * Math.PI), xt = 16, Ss = 8, Me = new M.Vector3(0, Fe + 1e-4, 0), Xe = new M.Vector3(), Ae = new M.Vector3(), _e = new M.Vector3(), ut = new M.Vector3();
function Zs(n, e) {
  const t = 2 * n.dot(e), s = n.dot(n) - Fe * Fe, i = t * t - 4 * s;
  return i <= 0 ? !1 : (-t - Math.sqrt(i)) / 2 > 0;
}
function Rt(n, e, t, s, i, o) {
  Xe.set(n.x, Math.max(n.y, 1e-3), n.z);
  const r = Xe.length();
  r > 0 && Xe.divideScalar(r), Ae.copy(e);
  const h = Ae.length();
  h > 0 && Ae.divideScalar(h);
  const l = 2 * Me.dot(Xe), c = Me.dot(Me) - Ve * Ve, d = (-l + Math.sqrt(Math.max(l * l - 4 * c, 0))) / 2, y = 2 * d / xt;
  let p = 0, m = 0, S = 0, A = 0, H = 0, P = 0, v = 0, x = 0;
  const T = Ys * i, _ = Ks * i, R = qs * i, b = Qs * t;
  for (let w = 0; w < xt; w++) {
    const O = (w + 0.5) / xt, k = O * O * d, C = O * y;
    _e.copy(Xe).multiplyScalar(k).add(Me);
    const N = Math.max(_e.length() - Fe, 0), V = Math.exp(-N / Ot), U = Math.exp(-N / _t);
    if (v += V * C, x += U * C, Zs(_e, Ae)) continue;
    const L = 2 * _e.dot(Ae), Y = _e.dot(_e) - Ve * Ve, E = Math.max(
      (-L + Math.sqrt(Math.max(L * L - 4 * Y, 0))) / 2,
      1e-4
    ) / Ss;
    let F = 0, K = 0;
    for (let oe = 0; oe < Ss; oe++) {
      const fe = (oe + 0.5) * E;
      ut.copy(Ae).multiplyScalar(fe).add(_e);
      const ve = Math.max(ut.length() - Fe, 0);
      F += Math.exp(-ve / Ot) * E, K += Math.exp(-ve / _t) * E;
    }
    const ee = v + F, Q = x + K, te = T * ee + b * Be * Q, q = _ * ee + b * Be * Q, G = R * ee + b * Be * Q, B = Math.exp(-te), J = Math.exp(-q), $ = Math.exp(-G), ne = V * C, ce = U * C;
    p += B * ne, m += J * ne, S += $ * ne, A += B * ce, H += J * ce, P += $ * ce;
  }
  const f = 1 + s;
  o.set(
    bt * (T * p * f + b * A),
    bt * (_ * m * f + b * H),
    bt * (R * S * f + b * P)
  );
}
function fn(n, e, t, s) {
  Ae.copy(n);
  const i = Ae.length();
  if (i > 0 && Ae.divideScalar(i), Zs(Me, Ae)) {
    s.set(0, 0, 0);
    return;
  }
  const o = 2 * Me.dot(Ae), r = Me.dot(Me) - Ve * Ve, l = (-o + Math.sqrt(Math.max(o * o - 4 * r, 0))) / 2 / 6;
  let c = 0, d = 0;
  for (let A = 0; A < 6; A++) {
    const H = (A + 0.5) * l;
    ut.copy(Ae).multiplyScalar(H).add(Me);
    const P = Math.max(ut.length() - Fe, 0);
    c += Math.exp(-P / Ot) * l, d += Math.exp(-P / _t) * l;
  }
  const y = Qs * e, p = Ys * t * c + y * Be * d, m = Ks * t * c + y * Be * d, S = qs * t * c + y * Be * d;
  s.set(Math.exp(-p), Math.exp(-m), Math.exp(-S));
}
const vs = 6, fs = 8, As = new M.Vector3(), st = new M.Vector3();
function An(n, e, t, s, i) {
  let o = 0, r = 0, h = 0, l = 0;
  for (let d = 0; d < vs; d++) {
    const y = (d + 0.5) / vs * (Math.PI / 2), p = Math.cos(y), m = Math.sin(y), S = p * m;
    for (let A = 0; A < fs; A++) {
      const H = (A + 0.5) / fs * (2 * Math.PI);
      As.set(m * Math.cos(H), p, m * Math.sin(H)), Rt(As, n, e, t, s, st), o += st.x * S, r += st.y * S, h += st.z * S, l += S;
    }
  }
  const c = l > 0 ? 1 / l : 0;
  i.set(o * c, r * c, h * c);
}
class Tt {
  _readers;
  _values;
  _initialized = !1;
  constructor(e) {
    this._readers = e, this._values = new Float64Array(e.length);
  }
  changed() {
    let e = !this._initialized;
    for (let t = 0; t < this._readers.length; t += 1) {
      const s = this._readers[t]();
      Object.is(s, this._values[t]) || (e = !0), this._values[t] = s;
    }
    return this._initialized = !0, e;
  }
}
class bn {
  /**
   * The baked equirectangular texture. Assign it as-is to `scene.environment`, a
   * `pmremTexture` sampler, or a raw TSL `texture()` read via `equirectUVFromDir`.
   * Reassigned by {@link setResolution} — rebind any sampler holding the old
   * reference after a resize.
   */
  texture;
  /** Cloud raymarch knobs for the bake, independent of the on-screen cloud quality. */
  bakeQuality;
  /** Per-frame bake gate. `false` ⇒ {@link update} is a no-op; {@link bakeAll} ignores this. */
  enabled = !0;
  /** Render the cloud composite on top of the sky dome. */
  bakeClouds = !0;
  /** Render the night-sky stars into the bake. No-op when built without a night sky. */
  bakeNightSky = !0;
  /** Render the sky dome into the bake. */
  bakeAtmosphere = !0;
  /** Bake width in pixels. Set via {@link setResolution}. */
  get width() {
    return this._width;
  }
  /** Bake height in pixels. Set via {@link setResolution}. */
  get height() {
    return this._height;
  }
  /** Bumped after each rendered environment frame. Compare against a last-seen value to detect a fresh frame. */
  get bakeVersion() {
    return this._bakeVersion;
  }
  /** Number of {@link update} calls skipped between volumetric-cloud raymarches. Clamped to [0, 8]. */
  get skipFrames() {
    return this._skipFrames;
  }
  set skipFrames(e) {
    this._skipFrames = Math.max(0, Math.min(8, Math.floor(e)));
  }
  _renderer;
  _atmosphere;
  _sun;
  _clouds;
  _cloudInputTracker;
  _prepareBake;
  _origin = new u.Vector3();
  // Tracks `_origin`, bound into both cloud materials' `rayOriginOverride`.
  _rayOriginUniform = g(new u.Vector3(0, 0, 0));
  _target;
  _width;
  _height;
  _skipFrames = 0;
  _updateCounter = 0;
  _bakeVersion = 0;
  _skyMaterial;
  _skyScene;
  _cloudMaterial;
  _cloudScene;
  _cloudTarget;
  _cloudCompositeMaterial;
  _cloudCompositeScene;
  _cirrusMaterial;
  _cirrusScene;
  _cirrusTexture = null;
  _cumulusDirty = !0;
  _compositionDirty = !0;
  _lastCloudLayersEnabled = !1;
  _lastCirrusWindOffset = new u.Vector3(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  _ambientSky;
  _environmentSnapshot;
  _qualitySnapshot;
  _compositionSnapshot;
  _lastDensityRevision = -1;
  _lastLightingRevision = -1;
  _lastLayerRevision = -1;
  _timeOfDay;
  _nightSky;
  _nightScene;
  _nightMaterial;
  // Scratch state for save/restore around the bake.
  _prevClearColor = new u.Color();
  constructor(e, t) {
    this._renderer = e.renderer, this._atmosphere = e.atmosphere, this._sun = e.sun, this._clouds = e.clouds, this._cloudInputTracker = e.cloudInputTracker, this._prepareBake = e.prepareBake, this._ambientSky = t, this._nightSky = e.nightSky ?? null, e.origin && (this._origin.copy(e.origin), this._rayOriginUniform.value.copy(e.origin)), this.skipFrames = e.skipFrames ?? 4, this._width = e.width ?? 384, this._height = e.height ?? this._width / 2, this._target = this._makeTarget(this._width, this._height), this.texture = this._target.texture;
    const s = z(ge().x, ge().y.oneMinus()), i = yt(s);
    this._skyMaterial = new Es(
      e.atmosphere,
      e.sun,
      e.transmittanceLUT,
      e.multiScatterLUT,
      e.skyViewLUT,
      i,
      // viewDirOverride (required)
      e.timeOfDay ?? null,
      e.moonTexture ?? null
    ), this._skyMaterial.side = u.FrontSide, this._skyMaterial.depthTest = !1;
    const o = X.makeScene(this._skyMaterial);
    if (o.scene.name = "sky-pro:envmap-sky", this._skyScene = o.scene, this._timeOfDay = e.timeOfDay ?? null, e.nightSky) {
      const y = new u.MeshBasicNodeMaterial();
      y.depthTest = !1, y.transparent = !0, y.blending = u.AdditiveBlending;
      const p = yt(
        z(ge().x, ge().y.oneMinus())
      );
      y.colorNode = se(
        e.nightSky.colorNodeForDirection(p),
        a(1)
      );
      const m = X.makeScene(y);
      m.scene.name = "sky-pro:envmap-night", this._nightMaterial = y, this._nightScene = m.scene;
    } else
      this._nightMaterial = null, this._nightScene = null;
    const r = e.cloudMarchSteps ?? 16;
    if (this.bakeQuality = new ks(), e.includeClouds === !1)
      this._cloudMaterial = null, this._cloudScene = null, this._cloudTarget = null, this._cloudCompositeMaterial = null, this._cloudCompositeScene = null, this._cirrusMaterial = null, this._cirrusScene = null;
    else {
      this.bakeQuality.maxSteps.value = r, this.bakeQuality.mipBaseLevel.value = e.cloudMipBase ?? 0, this.bakeQuality.lightStepSize.value = 200, this.bakeQuality.baseStepSize.value = 50, this.bakeQuality.earlyExitTransmittance = 0.1, this.bakeQuality.pixelConeAngle.value = Math.PI / this._height, this.bakeQuality.stepConeAngle.value = Math.PI / this._height;
      const y = yt(
        z(ge().x, ge().y.oneMinus())
      );
      this._cloudMaterial = new Gs(
        e.atmosphere,
        e.sun,
        e.clouds,
        this.bakeQuality,
        y,
        // rayDirOverride (required)
        this._rayOriginUniform,
        // rayOriginOverride (required)
        e.animatedClouds,
        e.timeOfDay ?? null,
        this._ambientSky
      ), this._cloudMaterial.baseShapeTexture = e.noiseTextures.baseShape, this._cloudMaterial.weatherTexture = e.noiseTextures.weather, this._cloudMaterial.skyViewLUT = e.skyViewLUT, this._cloudMaterial.init({ mrt: !1 }), this._cloudMaterial.depthTest = !1, this._cloudMaterial.depthWrite = !1, this._cloudMaterial.transparent = !1, this._cloudMaterial.blending = u.NoBlending, this._cloudMaterial.planetCenter.value.set(
        this._origin.x,
        -Te,
        this._origin.z
      );
      const p = X.makeScene(this._cloudMaterial);
      p.scene.name = "sky-pro:envmap-clouds", this._cloudScene = p.scene, this._cloudTarget = this._makeTarget(this._width, this._height, "SkyCumulusCache"), this._cirrusMaterial = new Us(
        e.atmosphere,
        e.sun,
        e.clouds,
        y,
        this._rayOriginUniform,
        e.noiseTextures.weather,
        e.animatedClouds,
        e.timeOfDay ?? null,
        this._ambientSky
      ), this._cirrusMaterial.depthTest = !1;
      const m = X.makeScene(this._cirrusMaterial);
      m.scene.name = "sky-pro:envmap-cirrus", this._cirrusScene = m.scene, this._cloudCompositeMaterial = new u.MeshBasicNodeMaterial(), this._cloudCompositeMaterial.depthTest = !1, this._cloudCompositeMaterial.depthWrite = !1, this._cloudCompositeMaterial.transparent = !0, this._cloudCompositeMaterial.blending = u.CustomBlending, this._cloudCompositeMaterial.blendEquation = u.AddEquation, this._cloudCompositeMaterial.blendSrc = u.OneFactor, this._cloudCompositeMaterial.blendDst = u.OneMinusSrcAlphaFactor, this._cloudCompositeMaterial.blendEquationAlpha = u.AddEquation, this._cloudCompositeMaterial.blendSrcAlpha = u.OneFactor, this._cloudCompositeMaterial.blendDstAlpha = u.OneMinusSrcAlphaFactor, this._cloudCompositeMaterial.colorNode = de(this._cloudTarget.texture, s);
      const S = X.makeScene(this._cloudCompositeMaterial);
      S.scene.name = "sky-pro:envmap-cloud-composite", this._cloudCompositeScene = S.scene;
    }
    const h = this._atmosphere, l = this._sun, c = this._timeOfDay;
    this._environmentSnapshot = new Tt([
      () => h.rayleigh.value,
      () => h.turbidity.value,
      () => h.mieDirectionalG.value,
      () => h.mieScatteringStrength.value,
      () => h.multipleScattering.value,
      () => h.skyMultipleScattering.value,
      () => h.groundAlbedo.value.r,
      () => h.groundAlbedo.value.g,
      () => h.groundAlbedo.value.b,
      () => l.direction.value.x,
      () => l.direction.value.y,
      () => l.direction.value.z,
      () => l.intensity.value,
      () => l.color.value.r,
      () => l.color.value.g,
      () => l.color.value.b,
      () => l.discSize.value,
      ...c ? [
        () => c.time.value,
        () => c.latitude,
        () => c.azimuth,
        () => c.moonDirection.value.x,
        () => c.moonDirection.value.y,
        () => c.moonDirection.value.z,
        () => c.moonPhase.value,
        () => c.moonIntensity.value,
        () => c.moonDiscBrightness.value,
        () => c.moonAngularSize.value,
        () => c.moonColor.value.r,
        () => c.moonColor.value.g,
        () => c.moonColor.value.b,
        () => c.moonAmbient.value,
        () => c.skyDarkness.value,
        () => c.moonPhaseIllumination.value,
        () => c.moonPhaseTrig.value.x,
        () => c.moonPhaseTrig.value.y
      ] : []
    ]);
    const d = this.bakeQuality;
    this._qualitySnapshot = new Tt([
      () => d.maxSteps.value,
      () => d.lightMarchTaps,
      () => d.lightStepSize.value,
      () => d.lightConeSpread.value,
      () => d.fullLightingAlpha.value,
      () => d.baseStepSize.value,
      () => d.stepConeFactor.value,
      () => d.maxOpticalDepthPerStep.value,
      () => d.earlyExitTransmittance,
      () => d.mipBaseLevel.value,
      () => d.baseShapeResolution.value,
      () => this._cloudMaterial?.baseShapeTexture?.version ?? -1,
      () => this._cloudMaterial?.weatherTexture?.version ?? -1
    ]), this._compositionSnapshot = new Tt([
      () => Number(this.bakeAtmosphere),
      () => Number(this.bakeNightSky),
      () => this._nightSky?.intensity.value ?? 0,
      () => this._nightSky?.textureRevision ?? -1,
      () => this._nightSky?.textureVersion ?? -1,
      () => this._cirrusTexture?.version ?? -1,
      // The weather map also drives the thin storm-haze deck.
      () => this._cloudMaterial?.weatherTexture?.version ?? -1
    ]), e.initialBake !== !1 && this.bakeAll(), this._syncInputDirtiness();
  }
  /** Set (or clear with `null`) the cirrus-deck mask used by the bake. */
  setCirrusTexture(e) {
    this._cirrusTexture !== e && (this._cirrusTexture = e, this._cirrusMaterial?.setCirrusTexture(e), this._compositionDirty = !0);
  }
  /**
   * Rebind the bake's cloud-noise textures. Call before disposing the outgoing texture.
   * @internal
   */
  setNoiseTextures(e) {
    this._cloudMaterial?.setNoiseTextures(e), e.weather && this._cirrusMaterial?.setWeatherTexture(e.weather), this._cumulusDirty = !0, this._compositionDirty = !0;
  }
  /** World-space point the sky is sampled from. Read-only view; write via {@link setOrigin}. */
  get origin() {
    return this._origin;
  }
  /** Move the sample point. Usually pinned to the reflective surface or the camera. */
  setOrigin(e) {
    this._origin.equals(e) || (this._origin.copy(e), this._rayOriginUniform.value.copy(e), this._cumulusDirty = !0, this._cloudScene !== null && this._clouds.enabled && this.bakeClouds && this._cirrusTexture !== null && (this._clouds.cirrus.strength.value > 0 || this._clouds.haze.density.value > 0) && (this._compositionDirty = !0), this._cloudMaterial && this._cloudMaterial.planetCenter.value.set(e.x, -Te, e.z));
  }
  /**
   * Resize the bake. Replaces {@link texture} — rebind any sampler holding the old
   * reference before the next render.
   * @param height defaults to `width / 2` (equirect is 2:1).
   */
  setResolution(e, t = e / 2) {
    e === this._width && t === this._height || (this._width = e, this._height = t, this._target.dispose(), this._target = this._makeTarget(e, t), this.texture = this._target.texture, this._cloudTarget?.setSize(e, t), this.bakeQuality.pixelConeAngle.value = Math.PI / t, this.bakeQuality.stepConeAngle.value = Math.PI / t, this.clearTexture());
  }
  /** Per-frame tick. Dirty cumulus follows {@link skipFrames}; clean inputs render nothing. */
  update() {
    if (!this.enabled) return;
    this._syncInputDirtiness();
    const e = this._updateCounter++, t = this._cloudScene !== null && this._clouds.enabled && this.bakeClouds, s = e % (this._skipFrames + 1) === 0, o = t && this._cirrusTexture !== null && (this._clouds.cirrus.strength.value > 0 || this._clouds.haze.density.value > 0) && !this._lastCirrusWindOffset.equals(
      this._clouds.wind.offset.value
    ), r = t !== this._lastCloudLayersEnabled;
    (o || r) && (this._compositionDirty = !0);
    const h = t && this._cumulusDirty && s;
    t || (this._cumulusDirty = !0), h && (this._compositionDirty = !0), !(!h && !this._compositionDirty) && this._renderEnvironment(h);
  }
  /**
   * Bake synchronously, ignoring {@link skipFrames} and {@link enabled}. Use after a
   * preset load or a large sun jump to refresh immediately.
   */
  bakeAll() {
    this._syncInputDirtiness();
    const e = this._cloudScene !== null && this._clouds.enabled && this.bakeClouds;
    this._renderEnvironment(e);
  }
  /** Compare all live bake inputs without allocating per-frame snapshots. */
  _syncInputDirtiness() {
    this._cloudInputTracker.update();
    const e = this._cloudInputTracker.densityRevision, t = this._cloudInputTracker.lightingRevision, s = this._cloudInputTracker.layerRevision;
    (e !== this._lastDensityRevision || t !== this._lastLightingRevision || s !== this._lastLayerRevision) && (this._cumulusDirty = !0), s !== this._lastLayerRevision && (this._compositionDirty = !0), this._lastDensityRevision = e, this._lastLightingRevision = t, this._lastLayerRevision = s, this._environmentSnapshot.changed() && (this._cumulusDirty = !0, this._compositionDirty = !0), this._qualitySnapshot.changed() && (this._cumulusDirty = !0), this._compositionSnapshot.changed() && (this._compositionDirty = !0);
  }
  _renderEnvironment(e) {
    this._prepareBake();
    const t = this._renderer, s = t.getRenderTarget(), i = t.autoClear, o = t.getClearAlpha();
    t.getClearColor(this._prevClearColor), e && this._cloudTarget && this._cloudScene && (this._cloudMaterial?.updateLightConeOffsets(), t.setRenderTarget(this._cloudTarget), t.setClearColor(0, 0), t.autoClear = !0, t.clear(), t.render(this._cloudScene, X.camera), this._cumulusDirty = !1), t.setRenderTarget(this._target), t.setClearColor(0, 1), t.autoClear = !0, t.clear(), this.bakeAtmosphere && t.render(this._skyScene, X.camera), this._nightScene && this.bakeNightSky && this._timeOfDay && this._timeOfDay.skyDarkness.value > 0.01 && (t.autoClear = !1, t.render(this._nightScene, X.camera)), this._clouds.enabled && this.bakeClouds && this._cirrusScene && (t.autoClear = !1, t.render(this._cirrusScene, X.camera), this._cloudCompositeScene && t.render(this._cloudCompositeScene, X.camera)), t.setRenderTarget(s), t.autoClear = i, t.setClearColor(this._prevClearColor, o), this._bakeVersion++, this._compositionDirty = !1, this._lastCloudLayersEnabled = this._cloudScene !== null && this._clouds.enabled && this.bakeClouds, this._lastCirrusWindOffset.copy(this._clouds.wind.offset.value), this.texture.pmremVersion++;
  }
  /**
   * Clear {@link texture} to opaque black. Use after disabling the bake so consumers
   * stop sampling the last baked frame.
   */
  clearTexture() {
    const e = this._renderer, t = e.getRenderTarget(), s = e.autoClear, i = e.getClearAlpha();
    e.getClearColor(this._prevClearColor), e.setRenderTarget(this._target), e.setClearColor(0, 1), e.autoClear = !0, e.clear(), this._cloudTarget && (e.setRenderTarget(this._cloudTarget), e.setClearColor(0, 0), e.clear(), this._cumulusDirty = !0), this._compositionDirty = !0, e.setRenderTarget(t), e.autoClear = s, e.setClearColor(this._prevClearColor, i), this.texture.pmremVersion++;
  }
  /** Release the render target and the bake's materials. */
  dispose() {
    this._target.dispose(), this._cloudTarget && this._cloudTarget.dispose(), this._skyMaterial.dispose(), this._nightMaterial && this._nightMaterial.dispose(), this._cloudMaterial && this._cloudMaterial.dispose(), this._cloudCompositeMaterial && this._cloudCompositeMaterial.dispose(), this._cirrusMaterial && this._cirrusMaterial.dispose();
  }
  _makeTarget(e, t, s = "SkyEquirect") {
    const i = new u.RenderTarget(e, t, {
      type: u.HalfFloatType,
      format: u.RGBAFormat,
      generateMipmaps: !1,
      // Longitudinal seam wraps; latitudinal poles clamp.
      wrapS: u.RepeatWrapping,
      wrapT: u.ClampToEdgeWrapping,
      minFilter: u.LinearFilter,
      magFilter: u.LinearFilter
    });
    return i.texture.name = s, i;
  }
}
class xn {
  densityRevision = 0;
  lightingRevision = 0;
  layerRevision = 0;
  historyRevision = 0;
  _clouds;
  _shapeInputs;
  _shapeValues;
  _lightingInputs;
  _lightingValues;
  _layerInputs;
  _layerValues;
  _lastWindDirection = new M.Vector3(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  _lastWindOffset = new M.Vector3(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  _lastGroundBounce = new M.Color(
    Number.NaN,
    Number.NaN,
    Number.NaN
  );
  _lastWindHeading = Number.NaN;
  _lastWindSpeed = Number.NaN;
  _lastEvolutionSpeed = Number.NaN;
  _lastEvolutionOffset = Number.NaN;
  _initialized = !1;
  constructor(e) {
    this._clouds = e;
    const { shape: t, lighting: s, wind: i, cirrus: o, haze: r, fade: h } = e;
    this._shapeInputs = [
      t.altitude,
      t.thickness,
      t.density,
      t.coverage,
      t.horizonCoverageStart,
      t.horizonCoverageRamp,
      t.horizonCoverageAmount,
      t.edgeSoftness,
      t.edgeSoftnessFalloff,
      t.weatherScale,
      t.baseScale,
      t.erosionScaleBaseMultiplier,
      t.baseStrength,
      t.erosionStrengthBase,
      t.erosionStrengthPeak,
      t.erosionShape,
      t.baseWeatherStrength,
      t.baseWeatherHeightStart,
      t.baseWeatherHeightEnd,
      i.skew
    ], this._shapeValues = new Float64Array(this._shapeInputs.length), this._lightingInputs = [
      s.scatteringAlbedo,
      s.powderStrength,
      s.ambientIntensity,
      s.baseShadowStrength,
      s.baseShadowHeight,
      s.moonGain
    ], this._lightingValues = new Float64Array(this._lightingInputs.length), this._layerInputs = [
      o.scale,
      o.strength,
      r.scale,
      r.density,
      h.hazeDensityScale,
      h.horizonMeltStart,
      h.horizonMeltEnd
    ], this._layerValues = new Float64Array(this._layerInputs.length);
  }
  /** Scan current values and advance only the revisions whose outputs changed. */
  update() {
    const e = !this._initialized, t = this._scan(this._shapeInputs, this._shapeValues) || e, s = this._scan(this._lightingInputs, this._lightingValues) || e, i = this._scan(this._layerInputs, this._layerValues) || e, o = this._clouds.wind, r = !o.direction.value.equals(this._lastWindDirection), h = !o.offset.value.equals(this._lastWindOffset), l = !Object.is(o.evolutionOffset.value, this._lastEvolutionOffset), c = !Object.is(o.heading, this._lastWindHeading) || !Object.is(o.speed, this._lastWindSpeed) || !Object.is(o.evolutionSpeed, this._lastEvolutionSpeed), d = !this._clouds.lighting.groundBounceAlbedo.value.equals(this._lastGroundBounce);
    (t || r || h || l) && this.densityRevision++, (s || d) && this.lightingRevision++, i && this.layerRevision++, (t || s || i || d || c) && this.historyRevision++, this._lastWindDirection.copy(o.direction.value), this._lastWindOffset.copy(o.offset.value), this._lastEvolutionOffset = o.evolutionOffset.value, this._lastWindHeading = o.heading, this._lastWindSpeed = o.speed, this._lastEvolutionSpeed = o.evolutionSpeed, this._lastGroundBounce.copy(this._clouds.lighting.groundBounceAlbedo.value), this._initialized = !0;
  }
  _scan(e, t) {
    let s = !1;
    for (let i = 0; i < e.length; i += 1) {
      const o = e[i].value;
      Object.is(o, t[i]) || (s = !0), t[i] = o;
    }
    return s;
  }
}
class Tn {
  /** Atmospheric-scattering sky dome. Add `sky.mesh` to your scene. */
  sky;
  /** Full-resolution 2D cirrus deck, drawn as a scene-background mesh behind the volumetric clouds. */
  cirrus;
  /** Volumetric cloud raymarch, rendered at `1 / sourceDiv` of screen resolution. */
  cloud;
  /** Amortized reconstruction of the cloud march; its output is what the composite reads. */
  cloudTemporal;
  /** Depth-tested fullscreen cloud layer. Add `cloudComposite.mesh` to your scene. */
  cloudComposite;
  /** Volumetric light shafts. Applied via `godRays.applyTo()`. */
  godRays;
  /** Top-down cloud shadow baker: light transmittance through the shell → low-res texture; scene receives via `cloudShadowFactor`. */
  cloudShadow;
  /** Shared resolution and Bayer-phase state for the march and temporal reconstruction. */
  cloudSampling;
  _atmosphereLUT;
  _skyViewLUT;
  _aerialPerspectiveFroxel;
  _ambientSky;
  _renderer;
  _atmosphere;
  _sun;
  _clouds;
  _animatedClouds;
  _cloudInputs;
  /** Screen-march quality inputs whose changes make reconstruction incompatible. */
  _cloudHistoryQualityUniforms;
  _cloudHistoryQualityValues;
  _cloudHistoryRevision = -1;
  _cloudHistoryLightMarchTaps = 0;
  _cloudHistoryEarlyExit = 0;
  _cloudHistoryBaseTexture = null;
  _cloudHistoryBaseTextureVersion = -1;
  _cloudHistoryWeatherTexture = null;
  _cloudHistoryWeatherTextureVersion = -1;
  _cloudHistoryCirrusTexture = null;
  _cloudHistoryCirrusTextureVersion = -1;
  _cloudHistoryStateInitialized = !1;
  _skyViewProjection = new u.Matrix4();
  _drawingBufferSize = new u.Vector2();
  _viewportWidth = 1;
  _viewportHeight = 1;
  _frameIndex = 0;
  /** Last-applied `clouds.enabled`, for edge detection in `_syncCloudsEnabled`. */
  _cloudsEnabled = !0;
  /** Set by `updateFrame`; armed camera snapshot fires on the first backdrop mesh drawn. */
  _capturePending = !1;
  constructor(e) {
    this._renderer = e.renderer, this._atmosphere = e.atmosphere, this._sun = e.sun, this._clouds = e.clouds, this._animatedClouds = e.animatedClouds, this._cloudInputs = new xn(e.clouds);
    const t = e.cloudQuality;
    this._cloudHistoryQualityUniforms = [
      t.maxSteps,
      t.lightStepSize,
      t.lightConeSpread,
      t.fullLightingAlpha,
      t.baseStepSize,
      t.stepConeFactor,
      t.maxOpticalDepthPerStep,
      t.mipBaseLevel,
      t.baseShapeResolution,
      t.ditherStrength
    ], this._cloudHistoryQualityValues = new Float64Array(
      this._cloudHistoryQualityUniforms.length
    ), this._atmosphereLUT = new un(e.atmosphere), this._atmosphereLUT.update(this._renderer), this._skyViewLUT = new pn(
      e.atmosphere,
      e.sun,
      this._atmosphereLUT.texture,
      this._atmosphereLUT.multiScatterTexture
    ), this._skyViewLUT.update(this._renderer), this._aerialPerspectiveFroxel = new yn(
      e.atmosphere,
      e.sun,
      e.clouds,
      this._atmosphereLUT.texture,
      this._atmosphereLUT.multiScatterTexture
    ), this._ambientSky = new vn(), this._ambientSky.update(e.atmosphere, e.sun, e.clouds.lighting), this.sky = new Ii(e.atmosphere, e.sun, {
      transmittanceLUT: this._atmosphereLUT.texture,
      multiScatterLUT: this._atmosphereLUT.multiScatterTexture,
      skyViewLUT: this._skyViewLUT.texture,
      timeOfDay: e.timeOfDay ?? null,
      moonTexture: e.moonTexture ?? null
    }), this.cirrus = new Oa(
      e.atmosphere,
      e.sun,
      e.clouds,
      this.sky.rayBasis,
      this.sky.cameraPositionUniform,
      e.cloudOptions.textures.weather,
      e.timeOfDay ?? null,
      this._ambientSky,
      e.animatedClouds
    );
    const s = e.cloudHistoryDiv ?? 2;
    this.cloudSampling = new qa(
      s,
      e.cloudSamplingLattice
    ), this.cloud = new Na(
      e.atmosphere,
      e.sun,
      e.clouds,
      e.cloudQuality,
      e.width,
      e.height,
      {
        ...e.cloudOptions,
        sourceDiv: this.cloudSampling.sourceDiv,
        transmittanceLUT: this._atmosphereLUT.texture,
        multiScatterLUT: this._atmosphereLUT.multiScatterTexture,
        skyViewLUT: this._skyViewLUT.texture,
        aerialInscatterLUT: this._aerialPerspectiveFroxel.inscatterTexture,
        aerialTransmittanceLUT: this._aerialPerspectiveFroxel.transmittanceTexture
      },
      e.timeOfDay ?? null,
      this._ambientSky,
      this.sky.rayBasis,
      e.animatedClouds
    ), this.cloudTemporal = new Fa(
      this.cloud.outputTextureNode,
      this.cloud.hitDistTextureNode,
      e.width,
      e.height,
      { historyDiv: s },
      this.sky.rayBasis
    ), this.cloudComposite = new Xa(
      this.cloudTemporal.outputTextureNode,
      this.cloudTemporal.hitDistTextureNode,
      this.sky.rayBasis,
      this.sky.cameraPositionUniform,
      e.renderer.logarithmicDepthBuffer === !0,
      e.timeOfDay ?? null
    ), this.cloudShadow = new on({
      cloud: e.clouds,
      quality: e.cloudQuality,
      sun: e.sun,
      // Bake follows the moon after sunset (moon shadows + moon god-ray structure).
      timeOfDay: e.timeOfDay ?? null,
      // Share the live cloud-noise textures so the shadow march samples the same field.
      weatherTexture: this.cloud.material.weatherTexture,
      baseShapeTexture: this.cloud.material.baseShapeTexture,
      animatedClouds: e.animatedClouds
    }), this.godRays = new nn(
      e.sun,
      e.godRays,
      e.atmosphere,
      this.cloudShadow.texture,
      this.cloudShadow.projection,
      this.sky.cameraPositionUniform,
      // Bounds the shaft march against the cloud layer; sampling the temporal
      // output here also keeps the dep edge that fires it before god rays.
      this.cloudTemporal.outputTextureNode,
      this.cloudTemporal.hitDistTextureNode,
      e.timeOfDay ?? null
    ), e.godRays.enabled = e.godRaysEnabled !== !1;
    const i = (o, r, h) => {
      this._captureCamera(h);
    };
    this.sky.mesh.onBeforeRender = i, this.cirrus.mesh.onBeforeRender = i, this.cloudComposite.mesh.onBeforeRender = i, this.resize(e.width, e.height);
  }
  /** The baked transmittance LUT texture, shared across sky and cloud materials. */
  get transmittanceLUTTexture() {
    return this._atmosphereLUT.texture;
  }
  /** The baked multiple-scattering LUT texture. */
  get multiScatterLUTTexture() {
    return this._atmosphereLUT.multiScatterTexture;
  }
  /** Shared angular sky radiance used by the sky, fog, and cloud horizon fade. */
  get skyViewLUTTexture() {
    return this._skyViewLUT.texture;
  }
  /** Baked sky-ambient terms (sun transmittance, zenith/horizon/ground radiance), refreshed each frame. */
  get ambientSky() {
    return this._ambientSky;
  }
  /** Applies `clouds.enabled` on the frame it changes: stops the passes and blanks the output. */
  _syncCloudsEnabled() {
    this._clouds.enabled !== this._cloudsEnabled && (this._cloudsEnabled = this._clouds.enabled, this.cloud.setRenderEnabled(this._cloudsEnabled), this.cloudTemporal.setRenderEnabled(this._cloudsEnabled), this.cloudComposite.mesh.visible = this._cloudsEnabled, this.cloudShadow.enabled = this._cloudsEnabled, this._cloudsEnabled || this.cloudTemporal.clearHistory(this._renderer));
  }
  /**
   * Per-frame update; call once before rendering. Refreshes the bakes and sun/state
   * uniforms and arms the camera snapshot, which fires at render time via
   * `_captureCamera` — so camera motion after this call still lands in the frame.
   */
  updateFrame(e) {
    e.updateMatrixWorld(), this._cloudInputs.update(), this._refreshSharedBakes(), this._syncCloudsEnabled(), this._clouds.enabled && (this.cloudShadow.updateFrame(e, this._cloudInputs.densityRevision), this.cloudShadow.bake(this._renderer)), this.godRays.updateUniforms(), this._capturePending = !0;
  }
  /**
   * Camera snapshot for the frame: view-ray + reprojection uniforms and the temporal
   * history copy. Runs from the first backdrop mesh's `onBeforeRender` after each
   * `updateFrame` — before the cloud passes render — reading the camera exactly as this
   * render draws it.
   */
  _captureCamera(e) {
    this._capturePending && (this._capturePending = !1, e.updateMatrixWorld(), this._skyViewProjection.copy(e.projectionMatrix).multiply(e.matrixWorldInverse), this.sky.rayBasis.update(e), this.sky.cameraPositionUniform.value.copy(e.position), this.cloudComposite.material.viewProjection.value.copy(
      this._skyViewProjection
    ), this._cloudsEnabled && (this._aerialPerspectiveFroxel.update(e), this.cloudSampling.updateFrame(this._frameIndex), this.cloud.updateFrame(
      e,
      this._frameIndex,
      this.cloudSampling
    ), this._cloudHistoryInputsChanged() && this.cloudTemporal.invalidateHistory(), this.cloudTemporal.updateFrame(
      this._renderer,
      e,
      this.cloud.unjitteredProjection,
      this.cloudSampling
    ), this.cloudComposite.material.cameraStatic.value = this.cloudTemporal.material.cameraStatic.value), this._frameIndex++);
  }
  /** Update the allocation-free cloud-input snapshot and report any incompatible change. */
  _cloudHistoryInputsChanged() {
    let e = !this._cloudHistoryStateInitialized;
    this._cloudHistoryRevision !== this._cloudInputs.historyRevision && (e = !0, this._cloudHistoryRevision = this._cloudInputs.historyRevision);
    for (let h = 0; h < this._cloudHistoryQualityUniforms.length; h += 1) {
      const l = this._cloudHistoryQualityUniforms[h].value;
      Object.is(l, this._cloudHistoryQualityValues[h]) || (e = !0), this._cloudHistoryQualityValues[h] = l;
    }
    const t = this.cloud.quality;
    t.lightMarchTaps !== this._cloudHistoryLightMarchTaps && (e = !0), t.earlyExitTransmittance !== this._cloudHistoryEarlyExit && (e = !0), this._cloudHistoryLightMarchTaps = t.lightMarchTaps, this._cloudHistoryEarlyExit = t.earlyExitTransmittance;
    const s = this.cloud.material, i = s.baseShapeTexture, o = s.weatherTexture, r = s.cirrusTexture;
    return (i !== this._cloudHistoryBaseTexture || (i?.version ?? -1) !== this._cloudHistoryBaseTextureVersion) && (e = !0), (o !== this._cloudHistoryWeatherTexture || (o?.version ?? -1) !== this._cloudHistoryWeatherTextureVersion) && (e = !0), (r !== this._cloudHistoryCirrusTexture || (r?.version ?? -1) !== this._cloudHistoryCirrusTextureVersion) && (e = !0), this._cloudHistoryBaseTexture = i, this._cloudHistoryBaseTextureVersion = i?.version ?? -1, this._cloudHistoryWeatherTexture = o, this._cloudHistoryWeatherTextureVersion = o?.version ?? -1, this._cloudHistoryCirrusTexture = r, this._cloudHistoryCirrusTextureVersion = r?.version ?? -1, this._cloudHistoryStateInitialized = !0, e;
  }
  /** Resize the cloud pass targets. `width`/`height` are CSS (logical) px — the renderer's current pixel ratio is applied internally. */
  resize(e, t) {
    this._viewportWidth = e, this._viewportHeight = t, this._applyCloudSamplingLayout();
  }
  /** Refresh the atmosphere resources shared by screen and environment rendering. */
  _refreshSharedBakes() {
    this._atmosphereLUT.update(this._renderer), this._skyViewLUT.update(this._renderer), this._ambientSky.update(this._atmosphere, this._sun, this._clouds.lighting);
  }
  /** `SkyEnvironment` sharing this pipeline's transmittance LUT + bakers; caller supplies scene-level config. */
  createSkyEnvironment(e) {
    return new bn(
      {
        ...e,
        transmittanceLUT: this._atmosphereLUT.texture,
        multiScatterLUT: this._atmosphereLUT.multiScatterTexture,
        skyViewLUT: this._skyViewLUT.texture,
        prepareBake: () => this._refreshSharedBakes(),
        animatedClouds: this._animatedClouds,
        cloudInputTracker: this._cloudInputs
      },
      this._ambientSky
    );
  }
  /** Runtime cloud resolution knob. `v` = reconstruction divisor (1/2/4/8); source divisor is derived. Clears history. */
  setHistoryDiv(e) {
    this.cloudSampling.setHistoryDiv(e) && this._applyCloudSamplingLayout();
  }
  /** Apply the shared layout atomically after a viewport or quality-setting change. */
  _applyCloudSamplingLayout() {
    const e = this._renderer.getPixelRatio();
    this.cloud.sourceDiv = this.cloudSampling.sourceDiv, this.cloudTemporal.historyDiv = this.cloudSampling.historyDiv, this.cloud.resize(this._viewportWidth, this._viewportHeight, e), this.cloudTemporal.resize(this._viewportWidth, this._viewportHeight, e), this._renderer.getDrawingBufferSize(this._drawingBufferSize), this.cloudSampling.setTargetSizes({
      screenWidth: this._drawingBufferSize.x,
      screenHeight: this._drawingBufferSize.y,
      sourceWidth: this.cloud.sourceWidth,
      sourceHeight: this.cloud.sourceHeight,
      historyWidth: this.cloudTemporal.historyWidth,
      historyHeight: this.cloudTemporal.historyHeight
    }), this.cloudTemporal.material.latticeSize.value = this.cloudSampling.lattice, this.cloudTemporal.setSamplingSizes(
      this.cloudSampling.sourceWidth,
      this.cloudSampling.sourceHeight,
      this.cloudSampling.historyWidth,
      this.cloudSampling.historyHeight
    ), this.cloudComposite.material.sourceSize.value.set(
      this.cloudSampling.historyWidth,
      this.cloudSampling.historyHeight
    ), this.cloudTemporal.clearHistory(this._renderer);
  }
  dispose() {
    this.sky.dispose(), this.cirrus.dispose(), this.cloud.dispose(), this.cloudTemporal.dispose(), this.cloudComposite.dispose(), this.godRays.dispose(), this.cloudShadow.dispose(), this._atmosphereLUT.dispose(), this._skyViewLUT.dispose(), this._aerialPerspectiveFroxel.dispose();
  }
}
const wn = 0.03;
function Mn(n) {
  const { sceneColor: e, viewDir: t, sceneDist: s, atmosphere: i, sun: o } = n, r = n.skyViewLUT ? null : qe(
    n.transmittanceLUT,
    n.multiScatterLUT
  );
  return le(() => {
    const h = (n.skyViewLUT ? Et(n.skyViewLUT, t, o.direction) : r(
      t,
      o.direction,
      i.turbidity,
      i.mieDirectionalG,
      i.skyMultipleScattering,
      i.mieScatteringStrength,
      i.rayleigh
    )).mul(o.intensity), l = s.mul(1e-3), c = a(1).sub(
      re(
        l.mul(i.fogDensity).mul(a(wn)).negate()
      )
    ), d = ye(
      i.fogFarFadeStart,
      i.fogFarFadeEnd,
      s
    ), y = D(c, d), p = n.cloudColor.sample(Se), m = lt(n.cloudHitDist.sample(Se).r, s), S = p.rgb.mul(m), A = p.a.mul(m), H = e.rgb.sub(S), P = S.add(
      ae(H, h.mul(a(1).sub(A)), y)
    ), v = lt(n.farPlane.mul(a(0.98)), s);
    return se(ae(P, e.rgb, v), e.a);
  })();
}
function Js(n, e, t) {
  let s = Math.imul(n >>> 0, 1664525) + 1013904223 >>> 0, i = Math.imul(e >>> 0, 1664525) + 1013904223 >>> 0, o = Math.imul(t >>> 0, 1664525) + 1013904223 >>> 0;
  s = s + Math.imul(i, o) >>> 0, i = i + Math.imul(o, s) >>> 0, o = o + Math.imul(s, i) >>> 0, s = (s ^ s >>> 16) >>> 0, i = (i ^ i >>> 16) >>> 0, o = (o ^ o >>> 16) >>> 0, s = s + Math.imul(i, o) >>> 0, i = i + Math.imul(o, s) >>> 0, o = o + Math.imul(s, i) >>> 0;
  const r = 1 / 4294967295;
  return [s * r, i * r, o * r];
}
function Ce(n, e) {
  return (n % e + e) % e;
}
function Hn(n, e) {
  const t = n[0] * e, s = n[1] * e, i = n[2] * e, o = Math.floor(t), r = Math.floor(s), h = Math.floor(i), l = t - o, c = s - r, d = i - h;
  let y = 1;
  for (let p = -1; p <= 1; p++)
    for (let m = -1; m <= 1; m++)
      for (let S = -1; S <= 1; S++) {
        const A = Ce(o + S, e), H = Ce(r + m, e), P = Ce(h + p, e), v = Js(A, H, P), x = S + v[0] - l, T = m + v[1] - c, _ = p + v[2] - d, R = x * x + T * T + _ * _;
        R < y && (y = R);
      }
  return Math.min(Math.sqrt(y), 1);
}
function wt(n, e, t) {
  let s = 0;
  for (let i = 0; i < e.length; i++)
    s += Hn(n, e[i]) * t[i];
  return s;
}
function bs(n) {
  return n * n * n * (n * (n * 6 - 15) + 10);
}
function Pe(n, e, t, s) {
  const i = n & 15, o = i < 8 ? e : t, r = i < 4 ? t : i === 12 || i === 14 ? e : s, h = (i & 1) === 0 ? o : -o, l = (i & 2) === 0 ? r : -r;
  return h + l;
}
function xs(n, e, t) {
  return Js(n, e, t)[0] * 256 >>> 0;
}
const Re = (n, e, t) => n + (e - n) * t;
function Ts(n, e, t, s) {
  const i = new Float64Array(n * n);
  let o = 0.5, r = 0, h = Math.max(1, Math.round(t));
  const l = new Float64Array(n), c = new Float64Array(n), d = new Int32Array(n), y = new Int32Array(n);
  for (let p = 0; p < s; p++) {
    const m = Math.round(h), S = e * h, A = Math.floor(S), H = S - A, P = H - 1, v = Ce(A, m), x = Ce(v + 1, m), T = bs(H);
    for (let f = 0; f < n; f++) {
      const w = f / n * h, O = Math.floor(w);
      l[f] = w - O, c[f] = bs(l[f]), d[f] = Ce(O, m), y[f] = Ce(d[f] + 1, m);
    }
    const _ = new Uint16Array(m * m), R = new Uint16Array(m * m);
    for (let f = 0; f < m; f++)
      for (let w = 0; w < m; w++)
        _[f * m + w] = xs(w, f, v), R[f * m + w] = xs(w, f, x);
    let b = 0;
    for (let f = 0; f < n; f++) {
      const w = l[f], O = w - 1, k = c[f], C = d[f] * m, N = y[f] * m;
      for (let V = 0; V < n; V++) {
        const U = l[V], L = U - 1, Y = c[V], I = d[V], E = y[V], F = _[C + I], K = _[C + E], ee = _[N + I], Q = _[N + E], te = R[C + I], q = R[C + E], G = R[N + I], B = R[N + E], J = Re(Pe(F, U, w, H), Pe(K, L, w, H), Y), $ = Re(Pe(ee, U, O, H), Pe(Q, L, O, H), Y), ne = Re(J, $, k), ce = Re(Pe(te, U, w, P), Pe(q, L, w, P), Y), oe = Re(Pe(G, U, O, P), Pe(B, L, O, P), Y), fe = Re(ce, oe, k);
        i[b] += Re(ne, fe, T) * o, b++;
      }
    }
    r += o, o *= 0.5, h *= 2;
  }
  for (let p = 0; p < i.length; p++)
    i[p] = i[p] / r * 0.5 + 0.5;
  return i;
}
const Dn = (n) => n < 0 ? 0 : n > 1 ? 1 : n, Mt = (n) => Math.round(Dn(n) * 255);
function Pn(n, e) {
  const { worleyLow: t, worleyMid: s, worleyHigh: i } = e, o = new Uint8Array(n.x * n.y * n.z * 4);
  for (let r = 0; r < n.z; r++)
    for (let h = 0; h < n.y; h++)
      for (let l = 0; l < n.x; l++) {
        const c = [l / n.x, h / n.y, r / n.z], d = 1 - wt(c, t.cells, t.weights), y = 1 - wt(c, s.cells, s.weights), p = 1 - wt(c, i.cells, i.weights), m = (l + h * n.x + r * n.x * n.y) * 4;
        o[m] = Mt(d), o[m + 1] = Mt(y), o[m + 2] = Mt(p), o[m + 3] = 255;
      }
  return o;
}
function On(n, e) {
  const t = Math.max(1, e.x >> 1), s = Math.max(1, e.y >> 1), i = Math.max(1, e.z >> 1), o = new Uint8Array(t * s * i * 4), r = (c) => c % e.x, h = (c) => c % e.y, l = (c) => c % e.z;
  for (let c = 0; c < i; c++)
    for (let d = 0; d < s; d++)
      for (let y = 0; y < t; y++) {
        const p = [0, 0, 0, 0];
        for (let S = 0; S < 2; S++)
          for (let A = 0; A < 2; A++)
            for (let H = 0; H < 2; H++) {
              const P = r(y * 2 + H), v = h(d * 2 + A), x = l(c * 2 + S), T = (P + v * e.x + x * e.x * e.y) * 4;
              p[0] += n[T], p[1] += n[T + 1], p[2] += n[T + 2], p[3] += n[T + 3];
            }
        const m = (y + d * t + c * t * s) * 4;
        o[m] = Math.round(p[0] * 0.125), o[m + 1] = Math.round(p[1] * 0.125), o[m + 2] = Math.round(p[2] * 0.125), o[m + 3] = Math.round(p[3] * 0.125);
      }
  return { data: o, dim: { x: t, y: s, z: i } };
}
function _n(n, e) {
  const t = Math.max(
    Math.floor(Math.log2(e.x)),
    Math.floor(Math.log2(e.y)),
    Math.floor(Math.log2(e.z))
  ), s = [n];
  let i = n, o = e;
  for (let r = 0; r < t; r++) {
    const h = On(i, o);
    s.push(h.data), i = h.data, o = h.dim;
  }
  return { dims: e, channels: 4, levels: s };
}
function Rn(n, e) {
  return _n(Pn(n, e), n);
}
function Cn(n) {
  return Math.round(Math.min(Math.max(n, 0), 1) * 255);
}
function ws(n) {
  return n * 13.37 + 0.5;
}
function Ms(n, e) {
  const {
    mainMass: t,
    detail: s,
    coverage: i
  } = e, o = new Uint8Array(n * n), r = Ts(
    n,
    ws(t.seed),
    t.frequency,
    t.octaves
  ), h = Ts(
    n,
    ws(s.seed),
    s.frequency,
    s.octaves
  );
  for (let l = 0; l < n * n; l++) {
    const c = Math.min(
      Math.max((r[l] - 0.5) * t.amplitude + 0.5, 0),
      1
    ), d = (h[l] * 2 - 1) * s.strength, y = c + d + (i - 0.5);
    o[l] = Cn(y);
  }
  return o;
}
class Nn {
  /** The live texture. Stable across re-fills. */
  texture;
  /** Generation profile. Mutate in place, then call {@link regenerate}. */
  profile;
  _resolution;
  /**
   * @param resolution Edge length in texels.
   * @param profile Generation profile; deep-copied, so later mutation of the argument
   *   doesn't reach this map.
   */
  constructor(e = 512, t = Di) {
    this._resolution = e, this.profile = structuredClone(t), this.texture = new u.DataTexture(
      Ms(e, this.profile),
      e,
      e,
      u.RedFormat,
      u.UnsignedByteType
    ), this.texture.wrapS = u.RepeatWrapping, this.texture.wrapT = u.RepeatWrapping, this.texture.minFilter = u.LinearFilter, this.texture.magFilter = u.LinearFilter, this.texture.needsUpdate = !0;
  }
  /** Edge length of the live map, in texels. */
  get resolution() {
    return this._resolution;
  }
  /** Re-fill at `size`. No-op when the map is already that size. */
  setResolution(e) {
    e !== this._resolution && (this._resolution = e, this.regenerate());
  }
  /** Adopt `params` wholesale — profile is deep-copied — then re-fill once. */
  applyParams(e) {
    Object.assign(this.profile, structuredClone(e.profile)), this._resolution = e.resolution, this.regenerate();
  }
  /**
   * Reads the current resolution and profile back as params. Inverse of
   * {@link applyParams}. The profile is deep-copied, so later mutation of the live
   * map doesn't reach the returned value.
   */
  toParams() {
    return {
      resolution: this._resolution,
      profile: structuredClone(this.profile)
    };
  }
  /** Re-fill the texture from the current resolution and profile. */
  regenerate() {
    const e = this._resolution, t = Ms(e, this.profile);
    this.texture.dispose(), this.texture.image = { data: t, width: e, height: e }, this.texture.needsUpdate = !0;
  }
  dispose() {
    this.texture.dispose();
  }
}
const kn = 828004942, jn = 16, Vn = 1;
function It(n, e) {
  return {
    x: Math.max(1, n.x >> e),
    y: Math.max(1, n.y >> e),
    z: Math.max(1, n.z >> e)
  };
}
function zn(n, e, t) {
  const s = It(n, e);
  return s.x * s.y * s.z * t;
}
function En(n) {
  const e = new DataView(n.buffer, n.byteOffset, n.byteLength);
  if (e.getUint32(0, !0) !== kn)
    throw new Error("noiseBlob: bad magic — not a noise blob");
  const t = e.getUint8(4);
  if (t !== Vn)
    throw new Error(`noiseBlob: unsupported version ${t}`);
  const s = e.getUint8(5), i = {
    x: e.getUint16(6, !0),
    y: e.getUint16(8, !0),
    z: e.getUint16(10, !0)
  }, o = e.getUint8(12), r = [];
  let h = jn;
  for (let l = 0; l < o; l++) {
    const c = zn(i, l, s);
    r.push(n.subarray(h, h + c)), h += c;
  }
  return { dims: i, channels: s, mipLevels: o, levels: r };
}
const Ye = {
  /** Cheapest: quarter-res clouds, no god rays, sky-only reflections. */
  low: {
    cloudHistoryDiv: 4,
    cloudFullLightingAlpha: 0.3,
    cloudShadowResolution: 128,
    cloudShadowMipLevel: 3,
    godRaysEnabled: !1,
    godRaySteps: 16,
    envMapEnabled: !0,
    envMapClouds: !1,
    envMapWidth: 256,
    envMapHeight: 128,
    envMapMarchSteps: 24,
    envMapMipBase: 3,
    weatherMapResolution: 256,
    baseShapeDims: { x: 16, y: 16, z: 16 }
  },
  /** Half-res clouds with god rays and cloudy reflections at reduced detail. */
  medium: {
    cloudHistoryDiv: 2,
    cloudFullLightingAlpha: 0.3,
    cloudShadowResolution: 256,
    cloudShadowMipLevel: 2,
    godRaysEnabled: !0,
    godRaySteps: 16,
    envMapEnabled: !0,
    envMapClouds: !0,
    envMapWidth: 384,
    envMapHeight: 192,
    envMapMarchSteps: 32,
    envMapMipBase: 2,
    weatherMapResolution: 512,
    baseShapeDims: { x: 32, y: 32, z: 32 }
  },
  /** Full-detail noise and shadows. The default tier. */
  high: {
    cloudHistoryDiv: 2,
    cloudFullLightingAlpha: 0.5,
    cloudShadowResolution: 512,
    cloudShadowMipLevel: 2,
    godRaysEnabled: !0,
    godRaySteps: 24,
    envMapEnabled: !0,
    envMapClouds: !0,
    envMapWidth: 512,
    envMapHeight: 256,
    envMapMarchSteps: 48,
    envMapMipBase: 1,
    weatherMapResolution: 1024,
    baseShapeDims: { x: 64, y: 64, z: 64 }
  },
  /** Highest detail: 1K shadow map and 1K reflections. */
  ultra: {
    cloudHistoryDiv: 2,
    cloudFullLightingAlpha: 0.7,
    cloudShadowResolution: 1024,
    cloudShadowMipLevel: 1,
    godRaysEnabled: !0,
    godRaySteps: 24,
    envMapEnabled: !0,
    envMapClouds: !0,
    envMapWidth: 1024,
    envMapHeight: 512,
    envMapMarchSteps: 64,
    envMapMipBase: 1,
    weatherMapResolution: 1024,
    baseShapeDims: { x: 64, y: 64, z: 64 }
  }
}, Ln = "./data/", In = (n) => new URL(Ln + n + ".bin", import.meta.url);
async function Bn(n) {
  const e = n instanceof URL ? n.href : n, t = await fetch(e);
  if (!t.ok || !t.body)
    throw new Error(`loadNoise: failed to fetch ${e} (${t.status})`);
  const s = t.body.pipeThrough(new DecompressionStream("gzip")), i = new Uint8Array(await new Response(s).arrayBuffer());
  return En(i);
}
function Fn(n, e) {
  const t = [];
  for (let s = 0; s < e; s++) {
    const i = It(n, s);
    t.push({ width: i.x, height: i.y, depth: i.z });
  }
  return t;
}
function Wn(n, e) {
  const { dims: t, levels: s } = e, i = new u.Data3DTexture(s[0], t.x, t.y, t.z);
  i.format = u.RGBAFormat, i.type = u.UnsignedByteType, i.wrapS = u.RepeatWrapping, i.wrapT = u.RepeatWrapping, i.wrapR = u.RepeatWrapping, i.minFilter = u.LinearMipMapLinearFilter, i.magFilter = u.LinearFilter, i.generateMipmaps = !1, i.mipmaps = Fn(t, s.length), i.needsUpdate = !0;
  const o = [];
  for (let r = 1; r < s.length; r++) {
    const h = It(t, r), l = new u.Data3DTexture(s[r], h.x, h.y, h.z);
    l.format = u.RGBAFormat, l.type = u.UnsignedByteType, l.needsUpdate = !0, n.copyTextureToTexture(
      l,
      i,
      new u.Box3(new u.Vector3(0, 0, 0), new u.Vector3(h.x, h.y, h.z)),
      new u.Vector3(0, 0, 0),
      0,
      r
    ), o.push(l);
  }
  for (const r of o) r.dispose();
  return i;
}
function $s(n, e) {
  return {
    baseShape: Wn(n, e)
  };
}
async function Gn(n, e = Vt) {
  const t = await Bn(In(`baseShape${e.x}`));
  return $s(n, t);
}
function Un(n, e = {}) {
  const t = Rn(
    e.baseShapeDims ?? Vt,
    e.baseShapeProfile ?? Hi
  );
  return $s(n, t);
}
const Xn = new Set(
  Object.values(Ye).map((n) => n.baseShapeDims.x)
);
async function Hs(n, e) {
  return e.x === e.y && e.y === e.z && Xn.has(e.x) ? (await Gn(n, e)).baseShape : Un(n, { baseShapeDims: e }).baseShape;
}
function Yn(n, e) {
  return n.x === e.x && n.y === e.y && n.z === e.z;
}
class Bt {
  _renderer;
  _texture;
  _dims;
  // Monotonic id for in-flight fetches; stale completions are discarded.
  _requestId = 0;
  constructor(e, t, s) {
    this._renderer = e, this._texture = t, this._dims = s;
  }
  /** Resolve the volume at `dims`. Await before rendering. */
  static async create(e, t) {
    const s = await Hs(e, t);
    return new Bt(e, s, t);
  }
  /** The live volume. Replaced by a successful {@link setDims}. */
  get texture() {
    return this._texture;
  }
  /** Resolution the live volume is baked at. */
  get dims() {
    return this._dims;
  }
  /**
   * Re-resolve the volume at `dims` and adopt it.
   *
   * Latest-request-wins: rapid switches can resolve out of order, so a superseded
   * completion discards its own texture rather than binding it over a newer one. Calling
   * with the current `dims` is not a no-op — it invalidates any in-flight request, so a
   * switch away and back can't land a stale texture.
   *
   * @returns the superseded texture, which the caller disposes once it has re-pointed its
   *   consumers at {@link texture}, or `null` when nothing was replaced.
   */
  async setDims(e) {
    const t = ++this._requestId;
    if (Yn(e, this._dims)) return null;
    const s = await Hs(this._renderer, e);
    if (t !== this._requestId)
      return s.dispose(), null;
    const i = this._texture;
    return this._texture = s, this._dims = e, i;
  }
  dispose() {
    this._texture.dispose();
  }
}
const Kn = 0.02;
class qn {
  /**
   * @param sys The sky whose state is published.
   * @param envMap Bake to publish. Omit to build a clouds-off bake owned by this provider
   *   and disposed with it.
   */
  constructor(e, t = null) {
    this.sys = e, this._skyColorLUT = qe(
      this.sys.pipeline.transmittanceLUTTexture,
      this.sys.pipeline.multiScatterLUTTexture
    ), t ? (this._envMap = t, this._ownsEnvMap = !1) : (this._envMap = e.createEnvironmentMap({ includeClouds: !1 }), this._ownsEnvMap = !0);
  }
  // Reuses the dome's sun-ray LUT so fog matches the direct view.
  _skyColorLUT;
  // The equirect bake published as the environment.
  _envMap;
  // True when this provider built `_envMap`, so it must tick and dispose it.
  _ownsEnvMap;
  /** Samples the prefiltered sky along a reflection direction. Linear HDR; the sun disc is in the bake, blurred by prefiltering. */
  createReflectionSampler() {
    return le(([e]) => {
      const t = be(e);
      return ci(
        this._envMap.texture,
        t,
        a(Kn)
      );
    });
  }
  /** Samples the sharp sky along a world direction, for tinting distant fog. Linear HDR; no sun disc. */
  createFogSampler() {
    const e = this.sys.sun.direction, t = this.sys.sun.intensity, s = this.sys.atmosphere.rayleigh, i = this.sys.atmosphere.turbidity, o = this.sys.atmosphere.mieDirectionalG, r = this.sys.atmosphere.skyMultipleScattering, h = this.sys.atmosphere.mieScatteringStrength;
    return le(([l]) => {
      const c = be(l);
      return this._skyColorLUT(
        c,
        e,
        i,
        o,
        r,
        h,
        s
      ).mul(t);
    });
  }
  /** The equirect environment bake. Replaced when the bake's resolution changes. */
  getEnvironmentTexture() {
    return this._envMap.texture;
  }
  /** The backdrop meshes, cloud layer included. */
  getMeshes() {
    return this.sys.backdropMeshes();
  }
  /** Live sun state for following an animated sun (time of day, presets). */
  getSun() {
    return {
      color: this.sys.sun.color,
      direction: this.sys.sun.direction,
      intensity: this.sys.sun.intensity
    };
  }
  /**
   * Re-centers the env-bake origin's XZ on the camera, keeping its Y. Also ticks the bake
   * when this provider owns it, so call it once per frame.
   */
  followCamera(e) {
    const t = this._envMap.origin;
    this._envMap.setOrigin(
      new u.Vector3(e.position.x, t.y, e.position.z)
    ), this._ownsEnvMap && this._envMap.update();
  }
  /** Submersion gate. `false` freezes the env-bake and switches the cloud layer off entirely. */
  setActive(e) {
    this._envMap.enabled = e, this.sys.clouds.enabled = e;
  }
  /** Disposes the bake if this provider created it. */
  dispose() {
    this._ownsEnvMap && this._envMap.dispose();
  }
}
const Qn = {
  baseStepSize: 25,
  stepConeFactor: 1.5,
  maxOpticalDepthPerStep: 0.5,
  maxSteps: 256,
  lightMarchTaps: 6,
  lightStepSize: 25,
  lightConeSpread: 0.05
};
class ei {
  /** Atmospheric scattering, haze, and fog. */
  atmosphere;
  /** Sun disc, color, and direction. */
  sun;
  /** Cloud shape, lighting, wind, and coverage. */
  clouds;
  /** Sun shafts. */
  godRays;
  /** Day/night clock and moon. */
  timeOfDay;
  /** Night-sky panorama. `null` when `config.nightSky` is omitted. */
  nightSky;
  /** Weather map driving cloud placement. Resolution follows the quality tier. @internal */
  weatherMap;
  /** The render passes backing the sky. @internal */
  pipeline;
  /** The cloud base-shape and weather textures currently bound. @internal */
  noiseTextures;
  _renderer;
  /** Camera planes, for decoding scene depth back to a linear one. */
  _cameraNear = g(0.1);
  _cameraFar = g(1e3);
  _camera;
  _scene;
  _sunDriver;
  // Screen-march cost knobs; the lighting threshold follows the active quality tier.
  _cloudQuality;
  _qualityLevel;
  _cloudRenderingMode;
  // Cloud-shadow-map TSL texture node, built lazily on first `cloudShadow()`.
  _cloudShadowTexNode = null;
  _baseShape;
  /** Env map owned by the last `createSkyProvider({ envMap: true })` call. Ticked in `update()`. */
  _providerEnvMap = null;
  /**
   * Build a sky. Await the result before rendering — the noise volumes and night-sky
   * textures load first.
   */
  static async create(e) {
    await e.renderer.init();
    const t = Ye[e.quality ?? "high"], s = new Oi(e.timeOfDay), [i, o] = await Promise.all([
      Bt.create(e.renderer, t.baseShapeDims),
      e.nightSky ? zt.load(e.nightSky, s) : null
    ]);
    return new ei(e, s, i, o);
  }
  constructor(e, t, s, i) {
    this._renderer = e.renderer, this._camera = e.camera, this._scene = e.scene, this.atmosphere = new yi(), this.sun = new Si(), this.clouds = new Mi(), this._cloudQuality = new ks(), this.godRays = new Pi(), this.timeOfDay = t, this.nightSky = i, this._qualityLevel = e.quality ?? "high", this._cloudRenderingMode = e.cloudRenderingMode ?? "dynamic";
    const o = Ye[this._qualityLevel];
    this._baseShape = s, this.weatherMap = new Nn(o.weatherMapResolution), this.noiseTextures = {
      baseShape: s.texture,
      weather: this.weatherMap.texture
    };
    const r = new u.Vector2();
    e.renderer.getSize(r);
    const h = r.x || 1, l = r.y || 1, c = e.godRays ?? o.godRaysEnabled;
    this.godRays.steps.value = o.godRaySteps, this._cloudQuality.applyParams({
      ...Qn,
      fullLightingAlpha: o.cloudFullLightingAlpha
    }), this._cloudQuality.baseShapeResolution.value = s.texture.image.width, this.pipeline = new Tn({
      renderer: e.renderer,
      width: h,
      height: l,
      atmosphere: this.atmosphere,
      sun: this.sun,
      clouds: this.clouds,
      animatedClouds: this._cloudRenderingMode !== "static",
      cloudQuality: this._cloudQuality,
      godRays: this.godRays,
      godRaysEnabled: c,
      cloudOptions: {
        textures: this.noiseTextures
      },
      cloudHistoryDiv: o.cloudHistoryDiv,
      cloudSamplingLattice: this._cloudRenderingMode === "ultra-dynamic" ? 2 : 4,
      timeOfDay: this.timeOfDay,
      moonTexture: i?.moonTexture ?? null
    }), this.pipeline.cloudShadow.setResolution(o.cloudShadowResolution), this.pipeline.cloudShadow.mipLevel.value = o.cloudShadowMipLevel, this._sunDriver = new Ri({
      timeOfDay: this.timeOfDay,
      sun: this.sun
    }), this._sunDriver.update(0), this.nightSky?.updateVisibility();
    for (const d of this.backdropMeshes()) this._scene.add(d);
  }
  /**
   * The backdrop meshes: dome, star panorama, cirrus deck, cloud layer. Added to the scene
   * by the constructor and removed by {@link dispose}. Each is placed in a `RenderLayer`, so
   * they sort behind your content on their own — this array's order is not the draw order.
   * The cloud layer depth-tests its ray-hit distance, so it hides behind opaque geometry
   * while transparent objects blend over it.
   * @internal
   */
  backdropMeshes() {
    const e = [this.pipeline.sky.mesh];
    return this.nightSky && e.push(this.nightSky.mesh), e.push(this.pipeline.cirrus.mesh, this.pipeline.cloudComposite.mesh), e;
  }
  /** Per-frame update: runs the cloud passes and refreshes all uniforms. Call once before rendering. */
  update(e) {
    this._cameraNear.value = this._camera.near, this._cameraFar.value = this._camera.far, this._sunDriver.update(e), this.clouds.wind.advance(this._cloudRenderingMode === "static" ? 0 : e), this.nightSky && (this.nightSky.mesh.position.copy(this._camera.position), this.nightSky.mesh.updateMatrixWorld(), this.nightSky.updateVisibility()), this.pipeline.updateFrame(this._camera), this._providerEnvMap && this._providerEnvMap.update();
  }
  /**
   * Composites the sky over your rendered scene: aerial-perspective fog, then god-ray shafts.
   * Returns a TSL node — splice it into your post graph in linear pre-exposure space (after
   * the scene, before exposure and bloom) so the result gets exposed and can bloom. Clouds
   * are not part of this chain — they render in your scene as one of the backdrop meshes.
   *
   * Depth comes from `scenePass`, and each stage is depth-correct: fog leaves open sky alone
   * and shafts stop at the nearest surface. Turn stages down with `atmosphere.fogDensity` and
   * `godRays.enabled`.
   *
   * @param sceneColor the color node you're chaining. Need not be `scenePass`'s own output —
   *   pass whatever earlier post stages produced (e.g. Water Pro's node).
   * @param scenePass the `pass(scene, camera)` node whose depth covers your scene geometry.
   */
  applyTo(e, t) {
    const i = t.getTextureNode("depth").sample(Se).r, o = this._renderer.logarithmicDepthBuffer === !0 ? (c) => di(c, this._cameraNear, this._cameraFar) : (c) => pi(c, this._cameraNear, this._cameraFar), { viewDir: r, dist: h } = gi(
      Se,
      i,
      this.pipeline.sky.rayBasis,
      this.pipeline.sky.cameraPositionUniform,
      o
    );
    let l = Mn({
      sceneColor: e,
      farPlane: this._cameraFar,
      viewDir: r,
      sceneDist: h,
      atmosphere: this.atmosphere,
      sun: this.sun,
      transmittanceLUT: this.pipeline.transmittanceLUTTexture,
      multiScatterLUT: this.pipeline.multiScatterLUTTexture,
      skyViewLUT: this.pipeline.skyViewLUTTexture,
      cloudColor: this.pipeline.cloudTemporal.outputTextureNode,
      cloudHitDist: this.pipeline.cloudTemporal.hitDistTextureNode
    });
    return this.pipeline.godRays.applyTo(l, r, h);
  }
  /**
   * TSL scalar (0..1): cloud sun-transmittance at a world position (1 = full sun, 0 = shadowed).
   * Multiply into the direct sun term only. Positions outside the shadow-map footprint return 1.0.
   */
  cloudShadow(e) {
    return this._cloudShadowTexNode || (this._cloudShadowTexNode = de(this.pipeline.cloudShadow.texture)), Rs(
      e,
      this._cloudShadowTexNode,
      this.pipeline.cloudShadow.projection
    );
  }
  /**
   * Resize the cloud pass targets and drop stale history. `width`/`height` are
   * CSS (logical) pixels — the same units as `renderer.setSize()`; the
   * renderer's current pixel ratio is applied internally. Call this after
   * `renderer.setPixelRatio()` too, so the cloud targets re-clone at the new
   * physical size.
   */
  resize(e, t) {
    this.pipeline.resize(e, t);
  }
  /**
   * Set (or clear with `null`) the cirrus-deck mask. Drives the full-res `cirrusMesh`
   * (direct view) and the provider env map's live thin-cloud pass. `scale` / `strength`
   * are live uniforms on `clouds.cirrus`.
   */
  setCirrusTexture(e) {
    this.pipeline.cirrus.setTexture(e), this._providerEnvMap && this._providerEnvMap.setCirrusTexture(e);
  }
  /** The currently active quality tier name. */
  get qualityLevel() {
    return this._qualityLevel;
  }
  /** Construction-time cloud behavior and sampling mode. Recreate the sky to change it. */
  get cloudRenderingMode() {
    return this._cloudRenderingMode;
  }
  /**
   * Switch the runtime quality tier. `overrides` replaces individual tier fields on top
   * of `level`. Returns a promise that resolves once the new noise is bound; safe to
   * ignore if you don't need to sequence work after it.
   */
  async setQualityLevel(e, t = {}) {
    const s = { ...Ye[e], ...t };
    if (this._qualityLevel = e, this.godRays.enabled = s.godRaysEnabled, this.godRays.steps.value = s.godRaySteps, this.pipeline.setHistoryDiv(s.cloudHistoryDiv), this._cloudQuality.applyParams({
      fullLightingAlpha: s.cloudFullLightingAlpha
    }), this.pipeline.cloudShadow.setResolution(s.cloudShadowResolution), this.pipeline.cloudShadow.mipLevel.value = s.cloudShadowMipLevel, this._providerEnvMap) {
      const o = this._providerEnvMap;
      o.enabled = s.envMapEnabled, o.bakeClouds = s.envMapClouds, (o.width !== s.envMapWidth || o.height !== s.envMapHeight) && o.setResolution(s.envMapWidth, s.envMapHeight), o.bakeQuality.applyParams({
        maxSteps: s.envMapMarchSteps,
        mipBaseLevel: s.envMapMipBase
      });
    }
    this.weatherMap.setResolution(s.weatherMapResolution);
    const i = await this._baseShape.setDims(s.baseShapeDims);
    i && (this._bindBaseShapeTexture(this._baseShape.texture), i.dispose());
  }
  /** Point every base-shape consumer at `baseShape`. Does not dispose the previous texture. */
  _bindBaseShapeTexture(e) {
    this.noiseTextures.baseShape = e, this.pipeline.cloud.material.setNoiseTextures({ baseShape: e }), this.pipeline.cloudShadow.setNoiseTextures({ baseShape: e }), this._providerEnvMap?.setNoiseTextures({ baseShape: e }), this._cloudQuality.baseShapeResolution.value = e.image.width;
  }
  /**
   * Apply a look preset, replacing the atmosphere, sun, time, cloud, god-ray, and
   * night-sky state wholesale. Every field is applied; omitting one does not leave the
   * current value in place.
   *
   * The cloud rendering mode, quality tier, march budgets, and env-map bake config are untouched.
   * Set the quality-owned values with {@link setQualityLevel}; cloud rendering mode is fixed at construction.
   */
  async applyPreset(e) {
    this.atmosphere.applyParams(e.atmosphere), this.timeOfDay.applyParams(e.time), this._sunDriver.update(0), this.sun.applyParams(e.sun);
    const t = e.cloud;
    this.clouds.applyParams({
      shape: t.shape,
      lighting: t.lighting,
      wind: t.wind,
      cirrus: t.cirrus,
      haze: t.haze,
      fade: t.fade
    }), this.godRays.applyParams(e.godRays), this.nightSky && (this.nightSky.intensity.value = e.nightSky.intensity), this.weatherMap.applyParams(e.noise.weather);
  }
  /**
   * Read the current sky state back as a `SkyParams`. Inverse of {@link applyPreset}:
   * feeding the result back in reproduces the state it was taken from. Colors and the
   * weather profile are copied, so later changes to the sky don't reach the result.
   *
   * The cloud rendering mode, quality tier, march budgets, and env-map bake config are not included —
   * they are not preset content. Read the first two from {@link cloudRenderingMode} and
   * {@link qualityLevel}.
   */
  toParams() {
    return {
      atmosphere: this.atmosphere.toParams(),
      sun: this.sun.toParams(),
      time: this.timeOfDay.toParams(),
      cloud: this.clouds.toParams(),
      noise: { weather: this.weatherMap.toParams() },
      godRays: this.godRays.toParams(),
      nightSky: { intensity: this.nightSky ? this.nightSky.intensity.value : 1 }
    };
  }
  /**
   * Build a `SkyProvider` to drive `threejs-water-pro` reflections. The default bake omits
   * clouds but retains the atmosphere, celestial discs, and configured stars;
   * `{ envMap: true }` adds clouds. A new call disposes the previous system-owned cloud
   * environment map; cloud-free providers own and dispose their own bakes.
   */
  createSkyProvider(e = {}) {
    this._providerEnvMap && (this._providerEnvMap.dispose(), this._providerEnvMap = null);
    let t = null;
    if (e.envMap) {
      const s = Ye[this._qualityLevel], i = {
        width: s.envMapWidth,
        height: s.envMapHeight,
        includeClouds: s.envMapClouds,
        cloudMarchSteps: s.envMapMarchSteps,
        cloudMipBase: s.envMapMipBase
      }, o = e.envMap === !0 ? {} : e.envMap;
      t = this.createEnvironmentMap({ ...i, ...o }), t.enabled = s.envMapEnabled, this._providerEnvMap = t;
    }
    return new qn(this, t);
  }
  /**
   * Build a `SkyEnvironment` — an equirectangular env map sharing this system's atmosphere, sun,
   * cloud state, and noise textures, with its own cloud-quality knobs. `envMap.texture` drops into
   * `scene.environment`, a `pmremTexture` reflection sampler, or a raw
   * `texture(envMap.texture, equirectUVFromDir(dir))` read unmodified.
   */
  createEnvironmentMap(e = {}) {
    return this.pipeline.createSkyEnvironment({
      renderer: this._renderer,
      atmosphere: this.atmosphere,
      sun: this.sun,
      clouds: this.clouds,
      noiseTextures: this.noiseTextures,
      // Time-of-day + moon texture drive the moon disc, ambient lift, and moonlit
      // clouds; the night-sky panorama adds the stars.
      timeOfDay: this.timeOfDay,
      moonTexture: this.nightSky?.moonTexture ?? null,
      nightSky: this.nightSky,
      ...e
    });
  }
  /** Releases all GPU resources and takes the backdrops back out of the scene. */
  dispose() {
    for (const e of this.backdropMeshes()) this._scene.remove(e);
    this._providerEnvMap && (this._providerEnvMap.dispose(), this._providerEnvMap = null), this.nightSky && this.nightSky.dispose(), this.pipeline.dispose(), this._baseShape.dispose(), this.weatherMap.dispose();
  }
}
const Zn = {
  atmosphere: {
    rayleigh: 0.41,
    turbidity: 1,
    mieDirectionalG: 0.8,
    mieScatteringStrength: 0.19,
    multipleScattering: 0.99,
    skyMultipleScattering: 0.66,
    exposure: 1,
    groundAlbedo: new M.Color(0.23, 0.23, 0.23),
    fogDensity: 1.25,
    fogFarFadeStart: 9100,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: 43.99999999999999,
    azimuth: -125.3852333469329,
    intensity: 7.8100000000000005,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 4e-4
  },
  time: {
    time: 0.6246442263011153,
    autoAdvanceSecondsPerDay: 0,
    latitude: 45,
    azimuth: 0,
    moon: {
      phase: 0.2,
      intensity: 1.0001,
      angularSize: 5e-4,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0.015,
      discBrightness: 4
    }
  },
  cloud: {
    shape: {
      altitude: 4e3,
      thickness: 5200,
      density: 0.019,
      coverage: 0.49,
      horizonCoverageStart: 2e4,
      horizonCoverageRamp: 45e3,
      horizonCoverageAmount: 0.12,
      edgeSoftness: 0.095,
      edgeSoftnessFalloff: 1,
      weatherScale: 29e3,
      baseScale: 7500,
      baseStrength: 0.69,
      erosionScaleBaseMultiplier: 0.13,
      erosionStrengthBase: 0.24,
      erosionStrengthPeak: 2.15,
      erosionShape: 1,
      baseWeatherStrength: 0.54,
      baseWeatherHeightStart: 0,
      baseWeatherHeightEnd: 0.13
    },
    lighting: {
      scatteringAlbedo: 1,
      powderStrength: 0.7,
      ambientIntensity: 0.7,
      groundBounceAlbedo: new M.Color(
        0.009134058699157796,
        0.015208514418949472,
        0.018500220124016652
      ),
      baseShadowStrength: 0.88,
      baseShadowHeight: 0.13,
      moonGain: 0.65
    },
    wind: {
      heading: 181,
      speed: 89,
      evolutionSpeed: 60.8,
      skew: 1750
    },
    cirrus: {
      scale: 35e3,
      strength: 0
    },
    haze: {
      scale: 4e4,
      density: 0
    },
    fade: {
      hazeDensityScale: 0.62,
      horizonMeltStart: 25e3,
      horizonMeltEnd: 45e3
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !0,
    moonGodRayScale: 0.26,
    strength: 0.67,
    sharpness: 9.2,
    extinction: 0,
    maxDistance: 1500
  },
  nightSky: {
    intensity: 0.3
  }
}, Jn = {
  atmosphere: {
    rayleigh: 2.87,
    turbidity: 2.4,
    mieDirectionalG: 0.59,
    mieScatteringStrength: 0,
    multipleScattering: 0.62,
    skyMultipleScattering: 0,
    exposure: 1,
    groundAlbedo: new M.Color(
      0.14702726648767014,
      0.12213877222015301,
      0.09530746662221588
    ),
    fogDensity: 0.85,
    fogFarFadeStart: 9100,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: 4.000000000000001,
    azimuth: -93.5161124074936,
    intensity: 5.94,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 4e-4
  },
  time: {
    time: 0.7362046933085502,
    autoAdvanceSecondsPerDay: 0,
    latitude: 45,
    azimuth: 0,
    moon: {
      phase: 0.36,
      intensity: 0.8201,
      angularSize: 4e-4,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0,
      discBrightness: 14
    }
  },
  cloud: {
    shape: {
      altitude: 3500,
      thickness: 3600,
      density: 4e-3,
      coverage: 0.47,
      horizonCoverageStart: 27e3,
      horizonCoverageRamp: 99100,
      horizonCoverageAmount: 0.84,
      edgeSoftness: 0.075,
      edgeSoftnessFalloff: 1.8,
      weatherScale: 46e3,
      baseScale: 7e3,
      erosionScaleBaseMultiplier: 0.13,
      baseStrength: 1.17,
      erosionStrengthBase: 0,
      erosionStrengthPeak: 3.48,
      erosionShape: 1,
      baseWeatherStrength: 0.76,
      baseWeatherHeightStart: 0,
      baseWeatherHeightEnd: 0.19
    },
    lighting: {
      scatteringAlbedo: 1,
      powderStrength: 0.36,
      ambientIntensity: 0.32,
      groundBounceAlbedo: new M.Color(0.18, 0.17, 0.15),
      baseShadowStrength: 0,
      baseShadowHeight: 0.49,
      moonGain: 0.42
    },
    wind: {
      heading: 0,
      speed: 0,
      evolutionSpeed: 22.2,
      skew: 0
    },
    cirrus: {
      scale: 4e4,
      strength: 0.8
    },
    haze: {
      scale: 41e3,
      density: 2.85
    },
    fade: {
      hazeDensityScale: 0.01,
      horizonMeltStart: 25e3,
      horizonMeltEnd: 15e4
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !0,
    moonGodRayScale: 0.02,
    strength: 0.53,
    sharpness: 4.3,
    extinction: 2e-4,
    maxDistance: 2e4
  },
  nightSky: {
    intensity: 0.05
  }
}, $n = {
  atmosphere: {
    rayleigh: 2.71,
    turbidity: 6,
    mieDirectionalG: 0.56,
    mieScatteringStrength: 0,
    multipleScattering: 0.58,
    skyMultipleScattering: 0.8,
    exposure: 1,
    groundAlbedo: new M.Color(
      0.4793201830913402,
      0.46207699964472876,
      0.2704977910022518
    ),
    fogDensity: 0.65,
    fogFarFadeStart: 9100,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: 90,
    azimuth: 156.4232818341799,
    intensity: 2.42,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 4e-4
  },
  time: {
    time: 0.4523626277881041,
    autoAdvanceSecondsPerDay: 0,
    latitude: 45,
    azimuth: 0,
    moon: {
      phase: 0.2,
      intensity: 1.0001,
      angularSize: 5e-4,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0.015,
      discBrightness: 4
    }
  },
  cloud: {
    shape: {
      altitude: 3800,
      thickness: 8e3,
      density: 4e-3,
      coverage: 0.64,
      horizonCoverageStart: 34e3,
      horizonCoverageRamp: 82100,
      horizonCoverageAmount: 0.41,
      edgeSoftness: 0.175,
      edgeSoftnessFalloff: 5.9,
      weatherScale: 93e3,
      baseScale: 19500,
      erosionScaleBaseMultiplier: 0.12,
      baseStrength: 0.96,
      erosionStrengthBase: 0,
      erosionStrengthPeak: 3.67,
      erosionShape: 1,
      baseWeatherStrength: 0.3,
      baseWeatherHeightStart: 0,
      baseWeatherHeightEnd: 0.1
    },
    lighting: {
      scatteringAlbedo: 1,
      powderStrength: 0.21,
      ambientIntensity: 0.09,
      groundBounceAlbedo: new M.Color(
        0.11697066774917994,
        0.14702726648767014,
        0.23455058215026167
      ),
      baseShadowStrength: 1,
      baseShadowHeight: 0.07,
      moonGain: 0.65
    },
    wind: {
      heading: 181,
      speed: 117.5,
      evolutionSpeed: 89.2,
      skew: 1700
    },
    cirrus: {
      scale: 7e4,
      strength: 0.02
    },
    haze: {
      scale: 175e3,
      density: 4
    },
    fade: {
      hazeDensityScale: 0,
      horizonMeltStart: 18e3,
      horizonMeltEnd: 46e3
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !1,
    moonGodRayScale: 0.26,
    strength: 0.81,
    sharpness: 8.7,
    extinction: 18e-5,
    maxDistance: 15500
  },
  nightSky: {
    intensity: 0.3
  }
}, eo = {
  atmosphere: {
    rayleigh: 1.02,
    turbidity: 10,
    mieDirectionalG: 0.6,
    mieScatteringStrength: 0.31,
    multipleScattering: 0.25,
    skyMultipleScattering: 0.25,
    exposure: 0.75,
    groundAlbedo: new M.Color(0.47, 0.47, 0.47),
    fogDensity: 0.65,
    fogFarFadeStart: 9100,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: 20,
    azimuth: 156.4232818341799,
    intensity: 6.71,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 4e-4
  },
  time: {
    time: 0.4523626277881041,
    autoAdvanceSecondsPerDay: 0,
    latitude: 45,
    azimuth: 0,
    moon: {
      phase: 0.2,
      intensity: 1.0001,
      angularSize: 5e-4,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0.015,
      discBrightness: 4
    }
  },
  cloud: {
    shape: {
      altitude: 6300,
      thickness: 8300,
      density: 7e-3,
      coverage: 0.65,
      horizonCoverageStart: 59e3,
      horizonCoverageRamp: 54100,
      horizonCoverageAmount: 0.66,
      edgeSoftness: 0.08,
      edgeSoftnessFalloff: 1.4,
      weatherScale: 96e3,
      baseScale: 15e3,
      erosionScaleBaseMultiplier: 0.15,
      baseStrength: 0.52,
      erosionStrengthBase: 0,
      erosionStrengthPeak: 2.69,
      erosionShape: 0,
      baseWeatherStrength: 0.36,
      baseWeatherHeightStart: 0,
      baseWeatherHeightEnd: 0.205
    },
    lighting: {
      scatteringAlbedo: 0.85,
      powderStrength: 0.27,
      ambientIntensity: 0.08,
      groundBounceAlbedo: new M.Color(
        0.12743768042608497,
        0.10461648408208657,
        0.04231141061442144
      ),
      baseShadowStrength: 1,
      baseShadowHeight: 0.11,
      moonGain: 0.65
    },
    wind: {
      heading: 181,
      speed: 117.5,
      evolutionSpeed: 89.2,
      skew: 1700
    },
    cirrus: {
      scale: 86e3,
      strength: 0
    },
    haze: {
      scale: 131e3,
      density: 1.8
    },
    fade: {
      hazeDensityScale: 0,
      horizonMeltStart: 1e4,
      horizonMeltEnd: 65e3
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !0,
    moonGodRayScale: 0.26,
    strength: 1.01,
    sharpness: 8.7,
    extinction: 18e-5,
    maxDistance: 15500
  },
  nightSky: {
    intensity: 0.3
  }
}, to = {
  atmosphere: {
    rayleigh: 1.98,
    turbidity: 2.8,
    mieDirectionalG: 0.8,
    mieScatteringStrength: 0.22,
    multipleScattering: 0.99,
    skyMultipleScattering: 1,
    exposure: 1,
    groundAlbedo: new M.Color(0.28, 0.28, 0.28),
    fogDensity: 2.05,
    fogFarFadeStart: 8e3,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: -20.280802489637406,
    azimuth: 68.31334296674535,
    intensity: 7.8100000000000005,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 5e-4
  },
  time: {
    time: 0.16846247676579926,
    autoAdvanceSecondsPerDay: 0,
    latitude: 45,
    azimuth: 0,
    moon: {
      phase: 0.22,
      intensity: 1,
      angularSize: 2193165251545004e-19,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0,
      discBrightness: 9
    }
  },
  cloud: {
    shape: {
      altitude: 3e3,
      thickness: 3e3,
      density: 0.011,
      coverage: 0.6,
      horizonCoverageStart: 11e3,
      horizonCoverageRamp: 39100,
      horizonCoverageAmount: 0.36,
      edgeSoftness: 0.125,
      edgeSoftnessFalloff: 1,
      weatherScale: 22e3,
      baseScale: 7e3,
      erosionScaleBaseMultiplier: 0.13,
      baseStrength: 0.71,
      erosionStrengthBase: 0.02,
      erosionStrengthPeak: 2.94,
      erosionShape: 1,
      baseWeatherStrength: 1,
      baseWeatherHeightStart: 0.03,
      baseWeatherHeightEnd: 0.215
    },
    lighting: {
      scatteringAlbedo: 0.81,
      powderStrength: 0,
      ambientIntensity: 0.93,
      groundBounceAlbedo: new M.Color(
        0.002428215868235294,
        0.002428215868235294,
        0.002428215868235294
      ),
      baseShadowStrength: 0,
      baseShadowHeight: 0.05,
      moonGain: 0.35
    },
    wind: {
      heading: 181,
      speed: 0,
      evolutionSpeed: 97.9,
      skew: 1700
    },
    cirrus: {
      scale: 71e3,
      strength: 0.01
    },
    haze: {
      scale: 4e4,
      density: 0
    },
    fade: {
      hazeDensityScale: 0.15,
      horizonMeltStart: 15e4,
      horizonMeltEnd: 15e4
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !0,
    moonGodRayScale: 0.05,
    strength: 0.28,
    sharpness: 10.3,
    extinction: 15e-5,
    maxDistance: 2e4
  },
  nightSky: {
    intensity: 0.035
  }
}, so = {
  atmosphere: {
    rayleigh: 1.45,
    turbidity: 1.5,
    mieDirectionalG: 0.72,
    mieScatteringStrength: 0.36,
    multipleScattering: 2,
    skyMultipleScattering: 2,
    exposure: 0.95,
    groundAlbedo: new M.Color(
      0.1878207722902346,
      0.1878207722902346,
      0.1878207722902346
    ),
    fogDensity: 1.25,
    fogFarFadeStart: 9100,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: 38,
    azimuth: -126.5229427216307,
    intensity: 10.780000000000001,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 4e-4
  },
  time: {
    time: 0.6246442263011153,
    autoAdvanceSecondsPerDay: 0,
    latitude: 47.5,
    azimuth: 0,
    moon: {
      phase: 0.2,
      intensity: 1.0001,
      angularSize: 5e-4,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0.015,
      discBrightness: 4
    }
  },
  cloud: {
    shape: {
      altitude: 1900,
      thickness: 4700,
      density: 0.01,
      coverage: 0.6,
      horizonCoverageStart: 1e4,
      horizonCoverageRamp: 48100,
      horizonCoverageAmount: 0.1,
      edgeSoftness: 0.075,
      edgeSoftnessFalloff: 1.8,
      weatherScale: 18e3,
      baseScale: 4500,
      erosionScaleBaseMultiplier: 0.19,
      baseStrength: 0.41,
      erosionStrengthBase: 0.53,
      erosionStrengthPeak: 1.41,
      erosionShape: 1,
      baseWeatherStrength: 0.69,
      baseWeatherHeightStart: 0,
      baseWeatherHeightEnd: 0.18
    },
    lighting: {
      scatteringAlbedo: 1,
      powderStrength: 0.25,
      ambientIntensity: 0.78,
      groundBounceAlbedo: new M.Color(
        0.05286064701616471,
        0.08437621153575764,
        0.16513219449147767
      ),
      baseShadowStrength: 0,
      baseShadowHeight: 0.05,
      moonGain: 0.65
    },
    wind: {
      heading: 109,
      speed: 60,
      evolutionSpeed: 23.4,
      skew: 1300
    },
    cirrus: {
      scale: 73e3,
      strength: 0
    },
    haze: {
      scale: 5e3,
      density: 0
    },
    fade: {
      hazeDensityScale: 0.5,
      horizonMeltStart: 14e3,
      horizonMeltEnd: 51e3
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !0,
    moonGodRayScale: 0.26,
    strength: 0.98,
    sharpness: 9.2,
    extinction: 0,
    maxDistance: 1500
  },
  nightSky: {
    intensity: 0.3
  }
}, io = {
  atmosphere: {
    rayleigh: 0.99,
    turbidity: 2,
    mieDirectionalG: 0.7,
    mieScatteringStrength: 0.15,
    multipleScattering: 0.99,
    skyMultipleScattering: 0.59,
    exposure: 1,
    groundAlbedo: new M.Color(1, 1, 1),
    fogDensity: 5,
    fogFarFadeStart: 5e3,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: 49.00000000000001,
    azimuth: 156.4232818341799,
    intensity: 7.7,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 4e-4
  },
  time: {
    time: 0.4523626277881041,
    autoAdvanceSecondsPerDay: 0,
    latitude: 45,
    azimuth: 0,
    moon: {
      phase: 0.2,
      intensity: 1.0001,
      angularSize: 5e-4,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0.015,
      discBrightness: 4
    }
  },
  cloud: {
    shape: {
      altitude: 3e3,
      thickness: 500,
      density: 2e-3,
      coverage: 0.5,
      horizonCoverageStart: 2e4,
      horizonCoverageRamp: 31100,
      horizonCoverageAmount: 0,
      edgeSoftness: 0.325,
      edgeSoftnessFalloff: 1,
      weatherScale: 26e3,
      baseScale: 1e4,
      erosionScaleBaseMultiplier: 0.22,
      baseStrength: 0.78,
      erosionStrengthBase: 2.99,
      erosionStrengthPeak: 3.75,
      erosionShape: 1,
      baseWeatherStrength: 0,
      baseWeatherHeightStart: 0.05,
      baseWeatherHeightEnd: 0.1
    },
    lighting: {
      scatteringAlbedo: 1,
      powderStrength: 0,
      ambientIntensity: 0.98,
      groundBounceAlbedo: new M.Color(0.18, 0.17, 0.15),
      baseShadowStrength: 0.08,
      baseShadowHeight: 0.6,
      moonGain: 0.65
    },
    wind: {
      heading: 181,
      speed: 86,
      evolutionSpeed: 26.8,
      skew: 1700
    },
    cirrus: {
      scale: 7e4,
      strength: 0.02
    },
    haze: {
      scale: 13e4,
      density: 0.2
    },
    fade: {
      hazeDensityScale: 2.15,
      horizonMeltStart: 3e4,
      horizonMeltEnd: 65e3
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !0,
    moonGodRayScale: 0.26,
    strength: 0.67,
    sharpness: 9.2,
    extinction: 5e-5,
    maxDistance: 9600
  },
  nightSky: {
    intensity: 0.3
  }
}, ao = {
  atmosphere: {
    rayleigh: 1.32,
    turbidity: 1.4,
    mieDirectionalG: 0.8,
    mieScatteringStrength: 0.19,
    multipleScattering: 0.99,
    skyMultipleScattering: 1.02,
    exposure: 1,
    groundAlbedo: new M.Color(0.23, 0.23, 0.23),
    fogDensity: 1.25,
    fogFarFadeStart: 9100,
    fogFarFadeEnd: 12600
  },
  sun: {
    elevation: 74,
    azimuth: -125.3852333469329,
    intensity: 7.81,
    color: new M.Color(1, 0.95, 0.85),
    discSize: 4e-4
  },
  time: {
    time: 0.6246442263011153,
    autoAdvanceSecondsPerDay: 0,
    latitude: 45,
    azimuth: 0,
    moon: {
      phase: 0.2,
      intensity: 1.0001,
      angularSize: 5e-4,
      color: new M.Color(
        0.7011018919268015,
        0.783537791521566,
        0.9473065367320066
      ),
      ambient: 0.015,
      discBrightness: 4
    }
  },
  cloud: {
    shape: {
      altitude: 1800,
      thickness: 5700,
      density: 0.05,
      coverage: 0.47,
      horizonCoverageStart: 1e4,
      horizonCoverageRamp: 39100,
      horizonCoverageAmount: 0,
      edgeSoftness: 0.195,
      edgeSoftnessFalloff: 2.1,
      weatherScale: 37e3,
      baseScale: 15e3,
      erosionScaleBaseMultiplier: 0.15,
      baseStrength: 1.72,
      erosionStrengthBase: 4.91,
      erosionStrengthPeak: 1.95,
      erosionShape: 0,
      baseWeatherStrength: 0.8,
      baseWeatherHeightStart: 0,
      baseWeatherHeightEnd: 0.5
    },
    lighting: {
      scatteringAlbedo: 1,
      powderStrength: 0.52,
      ambientIntensity: 1.16,
      groundBounceAlbedo: new M.Color(
        0.04817182422013895,
        0.061246054224174035,
        0.09305896283800832
      ),
      baseShadowStrength: 1,
      baseShadowHeight: 0.38,
      moonGain: 0.65
    },
    wind: {
      heading: 181,
      speed: 89,
      evolutionSpeed: 60.8,
      skew: 0
    },
    cirrus: {
      scale: 35e3,
      strength: 0
    },
    haze: {
      scale: 4e4,
      density: 0.05
    },
    fade: {
      hazeDensityScale: 0.62,
      horizonMeltStart: 3e4,
      horizonMeltEnd: 6e4
    }
  },
  noise: {
    weather: {
      resolution: 1024,
      profile: {
        mainMass: { frequency: 4, octaves: 5, seed: 0, amplitude: 1.32 },
        detail: { frequency: 6, octaves: 6, seed: 1, strength: 0.13 },
        coverage: 0.26
      }
    }
  },
  godRays: {
    enabled: !0,
    moonGodRayScale: 0.26,
    strength: 0.67,
    sharpness: 9.2,
    extinction: 0,
    maxDistance: 1500
  },
  nightSky: {
    intensity: 0.3
  }
}, oo = {
  partlyCloudy: Zn,
  stunningSunset: Jn,
  thunderstorm: $n,
  stormyEvening: eo,
  moonlitNight: to,
  fluffy: so,
  hazy: io,
  pixar: ao
};
export {
  yi as Atmosphere,
  Vi as BUNDLED_MOON_TEXTURE_URL,
  Mi as Clouds,
  Pi as GodRays,
  oo as PRESETS,
  Ye as QUALITY_LEVELS,
  dt as RenderLayer,
  ei as SkySystem,
  Si as Sun,
  Ri as SunDriver,
  Oi as TimeOfDay,
  Ni as equirectUVFromDir,
  pt as placeInLayer
};
//# sourceMappingURL=index.js.map
