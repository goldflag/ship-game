import * as THREE from 'three/webgpu';
import type { rtt } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { SkySystem } from '../../../vendor/threejs-sky-pro/build/index.js';
import type { WaterSystem } from '../../../vendor/threejs-water-pro/build/index.js';
import type { AircraftView } from '../AircraftView';
import type { CombatEffects } from '../CombatEffects';
import {
  aircraftDetailScale,
  cloudTier,
  effectsDensity,
  frameIntervalMs,
  sanitizeGraphicsSettings,
  shadowMapSize,
  shipDetailBudgetPx,
  type GraphicsSettings,
} from '../graphicsSettings';
import type { ShipFunnelSmoke } from '../ShipFunnelSmoke';

/** What applying graphics settings reads from and writes to `Game`, each member at the moment
 * of use. The settings, frame pacing, detail budget and display pipeline stay fields of `Game`:
 * the frame loop, start-up and the diagnostics pages read them there. */
export interface GraphicsContext {
  settings: GraphicsSettings;
  frameIntervalMs: number;
  detailBudgetPx: number;
  pipeline: THREE.RenderPipeline | undefined;
  readonly renderer: THREE.WebGPURenderer;
  /** The composited frame the display pass smooths; absent until start-up has built it. */
  readonly finalFrame?: ReturnType<typeof rtt>;
  readonly water?: WaterSystem;
  /** The scene's sun, whose shadow settings the near and wide maps follow. */
  readonly sunLight?: THREE.DirectionalLight;
  readonly sky?: SkySystem;
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
    if (previous.antialiasing !== settings.antialiasing && context.finalFrame) this.buildPipeline();
    if (previous.reflections !== settings.reflections) this.applyReflections();
    if (previous.shadows !== settings.shadows) this.applyShadows();
    if (previous.clouds !== settings.clouds) this.applyClouds();
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

  /** The display pass: the composited frame with the selected edge smoothing. */
  buildPipeline(): void {
    const context = this.context,
      { antialiasing } = context.settings;
    context.pipeline?.dispose();
    const frame = context.finalFrame!;
    const output = antialiasing === 'smaa' ? smaa(frame) : antialiasing === 'fxaa' ? fxaa(frame) : frame;
    const pipeline = (context.pipeline = new THREE.RenderPipeline(context.renderer, output));
    pipeline.outputColorTransform = false;
  }

  /** Screen-space reflections are a live uniform; the sky-only mirror stays on. */
  applyReflections(): void {
    const { water, settings } = this.context;
    if (water) water.ssr.enabled = settings.reflections === 'scene';
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

  /** Cloud tiers change march budgets live; a coarser noise volume refills on the CPU once. */
  applyClouds(): void {
    const context = this.context,
      sky = context.sky;
    if (!sky) return;
    const tier = cloudTier(context.settings.clouds);
    this.cloudTask = this.cloudTask
      .then(() =>
        sky.setQualityLevel(tier.level, {
          godRaysEnabled: false,
          envMapWidth: tier.envMapWidth,
          envMapHeight: tier.envMapWidth / 2,
          envMapMarchSteps: tier.envMapMarchSteps,
        }),
      )
      .catch((error) => {
        if (!context.disposed) context.reportError(error instanceof Error ? error.message : String(error));
      });
  }
}
