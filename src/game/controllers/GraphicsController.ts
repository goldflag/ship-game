import * as THREE from 'three/webgpu';
import { mix, step, vec4, type pass } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { SkyApi } from '../sky/contracts';
import type { OceanApi } from '../ocean/contracts';
import type { AircraftView } from '../AircraftView';
import type { CombatEffects } from '../CombatEffects';
import type { DisplayTransform } from '../DisplayTransform';
import {
  aircraftDetailScale,
  effectsDensity,
  frameIntervalMs,
  sanitizeGraphicsSettings,
  shadowMapSize,
  shipDetailBudgetPx,
  type GraphicsSettings,
} from '../graphicsSettings';
import type { ShipFunnelSmoke } from '../ShipFunnelSmoke';
import type { ShipOcclusion } from '../ShipOcclusion';
import type { ShipWake } from '../ShipWake';
import { MOTION_OUTPUT, TemporalAntialiasing } from '../TemporalAntialiasing';

/** What applying graphics settings reads from and writes to `Game`, each member at the moment
 * of use. The settings, frame pacing, detail budget and display pipeline stay fields of `Game`:
 * the frame loop, start-up and the diagnostics pages read them there. */
export interface GraphicsContext {
  settings: GraphicsSettings;
  frameIntervalMs: number;
  detailBudgetPx: number;
  pipeline: THREE.RenderPipeline | undefined;
  readonly renderer: THREE.WebGPURenderer;
  /** Builds the composited frame the display pass smooths; absent until start-up has built it. */
  readonly display?: DisplayTransform;
  /** The scene pass behind the display frame; temporal AA adds its motion target and depth. */
  readonly scenePass?: ReturnType<typeof pass>;
  readonly camera: THREE.PerspectiveCamera;
  readonly ocean?: Pick<OceanApi, 'reflections'>;
  /** The scene's sun, whose shadow settings the near and wide maps follow; absent until start-up creates it. */
  readonly sunLight?: THREE.DirectionalLight;
  readonly sky?: Pick<SkyApi, 'setQuality'>;
  /** Ship-on-ship ambient occlusion; absent until start-up has created it. */
  readonly occlusion?: Pick<ShipOcclusion, 'setLevel'>;
  /** The sea's wake and hull contact; absent until start-up has created it. */
  readonly shipWake?: Pick<ShipWake, 'shelter'>;
  readonly aircraftView: Pick<AircraftView, 'detailScale'>;
  readonly effects: Pick<CombatEffects, 'setDensity'>;
  readonly funnelSmoke: Pick<ShipFunnelSmoke, 'density'>;
  readonly disposed: boolean;
  /** Render scale changed: the next frame resizes the renderer. */
  requestResize(): void;
  reportError(message: string): void;
}

/** Applies graphics settings rows to the running scene. Start-up calls the individual
 * appliers as each system comes up; `apply` re-runs only the rows that changed. */
export class GraphicsController {
  private cloudTask: Promise<void> = Promise.resolve();
  /** Once shadow shaders exist they stay compiled; Off only zeroes and pauses them. */
  private shadowsBuilt = false;
  /** Built on first use and kept: its per-object history outlives a switch away and back. */
  private temporal?: TemporalAntialiasing;

  constructor(private readonly context: GraphicsContext) {}

  /** Apply changed rows to the running scene. Ocean tier and terrain density are
   * read when the port loads and when a battle's islands are built. */
  apply(next: GraphicsSettings): void {
    const context = this.context,
      previous = context.settings;
    const settings = (context.settings = sanitizeGraphicsSettings(next));
    context.frameIntervalMs = frameIntervalMs(settings.frameLimit);
    this.applyDetail();
    if (previous.renderScale !== settings.renderScale) context.requestResize();
    if ((previous.antialiasing !== settings.antialiasing || previous.bloom !== settings.bloom) && context.display) this.buildPipeline();
    if (previous.reflections !== settings.reflections) this.applyReflections();
    if (previous.shadows !== settings.shadows) this.applyShadows();
    if (previous.clouds !== settings.clouds) this.applyClouds();
    if (previous.ambientOcclusion !== settings.ambientOcclusion) this.applyAmbientOcclusion();
    if (previous.waterShadows !== settings.waterShadows) this.applyWaterShadows();
  }

  /** The sea reads its shadow maps each frame (`updateWaterShadows`); the darker water beside hulls, where their sides
   * hide the sky, rides the same row: Off drops it from the sea's shader. */
  applyWaterShadows(): void {
    const wake = this.context.shipWake;
    if (wake) wake.shelter = this.context.settings.waterShadows !== 'off';
  }

  /** Off removes the occlusion node from every ship material and skips its passes, so the
   * frame is exactly the one without it; turning it on recompiles the ship materials once. */
  applyAmbientOcclusion(): void {
    this.context.occlusion?.setLevel(this.context.settings.ambientOcclusion);
  }

  applyDetail(): void {
    const context = this.context,
      { settings } = context;
    context.detailBudgetPx = shipDetailBudgetPx(settings.modelDetail);
    context.aircraftView.detailScale = aircraftDetailScale(settings.modelDetail);
    const density = effectsDensity(settings.effects);
    context.effects.setDensity(density);
    context.funnelSmoke.density = density;
  }

  /** The display pass: the composited frame, with or without bloom, and the selected edge smoothing. */
  buildPipeline(): void {
    const context = this.context,
      { antialiasing, bloom } = context.settings;
    context.pipeline?.dispose();
    const frame = context.display!.build(bloom === 'on');
    const scenePass = context.scenePass!;
    let output;
    if (antialiasing === 'taa') {
      const temporal = (this.temporal ??= new TemporalAntialiasing(context.camera));
      temporal.reset();
      scenePass.setMRT(temporal.mrt);
      const resolved = temporal.resolve(frame, scenePass.getTextureNode('depth'), scenePass.getTextureNode(MOTION_OUTPUT));
      // The resolve keeps depth in alpha for the next frame, negative where a pixel took no
      // history (the sea, tracers): those keep FXAA's spatial smoothing. The canvas is opaque.
      output = vec4(mix(resolved.rgb, (fxaa(resolved) as unknown as THREE.Node<'vec4'>).rgb, step(resolved.a, 0)), 1);
    } else {
      this.temporal?.release();
      removeSceneTarget(scenePass, MOTION_OUTPUT);
      output = antialiasing === 'smaa' ? smaa(frame) : antialiasing === 'fxaa' ? fxaa(frame) : frame;
    }
    const pipeline = (context.pipeline = new THREE.RenderPipeline(context.renderer, output));
    pipeline.outputColorTransform = false;
  }

  /** Temporal AA takes no history while a layer without scene depth is composited. */
  suspendTemporal(suspended: boolean): void { if (this.temporal) this.temporal.suspended = suspended; }

  /** Frees what the display pass owns beyond the pipeline itself. */
  dispose(): void { this.temporal?.release(); }

  /** Screen-space reflections switch live; the sky reflection stays on. */
  applyReflections(): void {
    const { ocean, settings } = this.context;
    if (ocean) ocean.reflections.screenSpace = settings.reflections === 'scene';
  }

  applyShadows(): void {
    const sunlight = this.context.sunLight;
    if (!sunlight) return;
    const size = shadowMapSize(this.context.settings.shadows);
    // Retain an allocated map when switching Off: Three's cached capture
    // programs still reference it. Zero intensity removes shadows and stopping
    // updates removes caster passes, without disposing live shader resources.
    if (size > 0) this.shadowsBuilt = true;
    sunlight.castShadow = this.shadowsBuilt;
    sunlight.shadow.intensity = size > 0 ? 1 : 0;
    sunlight.shadow.autoUpdate = size > 0;
    if (!size) {
      sunlight.shadow.needsUpdate = false;
      return;
    }
    sunlight.shadow.mapSize.set(size, size);
    // Keep the receiver offset proportional to a shadow texel in world meters.
    // A fixed 10 cm offset leaves diagonal self-shadow bands on broad hulls at
    // Low's 1024px resolution; finer maps need proportionally less offset.
    sunlight.shadow.normalBias = (0.75 * (sunlight.shadow.camera.right - sunlight.shadow.camera.left)) / size;
    sunlight.shadow.needsUpdate = true;
  }

  /** Cloud tiers change the sky's march budgets, bakes and particle counts live. */
  applyClouds(): void {
    const context = this.context,
      sky = context.sky;
    if (!sky) return;
    const quality = context.settings.clouds;
    this.cloudTask = this.cloudTask
      .then(() => sky.setQuality(quality))
      .catch((error) => {
        if (!context.disposed) context.reportError(error instanceof Error ? error.message : String(error));
      });
  }
}

/** Drop an extra scene target, so that materials again write the colour target alone. */
function removeSceneTarget(scenePass: ReturnType<typeof pass>, name: string): void {
  scenePass.setMRT(null);
  const internals = scenePass as unknown as { _textures: Record<string, THREE.Texture>; _textureNodes: Record<string, unknown>; _previousTextures: Record<string, THREE.Texture> };
  const texture = internals._textures[name];
  if (!texture) return;
  const targets = scenePass.renderTarget.textures;
  targets.splice(targets.indexOf(texture), 1);
  delete internals._textures[name]; delete internals._textureNodes[name];
  texture.dispose();
}
