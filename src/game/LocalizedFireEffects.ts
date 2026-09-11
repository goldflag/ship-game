import type { BattleSession } from './session/BattleSession';
import * as THREE from 'three/webgpu';
import { mountFrame } from '../simulation/mountFrames';
import type { Combatant } from '../simulation/damage';
import type { ShipState } from '../simulation/ship';
import type { Vec3 } from '../ships/blueprint';
import { localToWorld } from '../simulation/geometry';
import { EffectParticlePool, effectTexture } from './EffectParticles';

interface FireSource { actor: Combatant; position: Vec3; local: Vec3; pose: ShipState; train: number; intensity: number; size: number; mount: boolean; score: number; phase: number; }
export interface FireDisplayPose { actor: Combatant; motion: ShipState; }
const MAX_SOURCES = 32;

/** Presentation of existing finite fires. No new damage locations or fuel stores.
 * Two fleet-wide sprite batches; camera relevance replaces actor-order starvation. */
export class LocalizedFireEffects {
  readonly root = new THREE.Group();
  private readonly flameMap = effectTexture('flame');
  private readonly smokeMap = effectTexture('smoke');
  private readonly flames = new EffectParticlePool(MAX_SOURCES * 3, this.flameMap);
  private readonly smoke = new EffectParticlePool(512, this.smokeMap, false, undefined, true);
  private readonly position = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();
  private smokeTime = 0;
  private time = 0;
  private sourceCount = 0;

  constructor() {
    this.root.name = 'Localized ship fires';
    this.flames.mesh.name = 'Attached fire tongues'; this.smoke.mesh.name = 'Local fire smoke';
    // Water's depth composite otherwise erases low flames against the sea.
    this.flames.mesh.material.depthWrite = true;
    this.flames.mesh.material.alphaTest = .025;
    this.flames.mesh.material.toneMapped = false;
    this.root.add(this.smoke.mesh, this.flames.mesh);
  }

  update(sim: BattleSession, dt: number, camera: THREE.Camera, wind: THREE.Vector3, hiddenSourceId?: string, poses?: readonly FireDisplayPose[]): void {
    this.time += dt; this.smokeTime += dt;
    this.smoke.advance(dt, wind);
    // Rebuild living flame tongues from state every frame: attached during motion,
    // frozen during pause, and gone immediately when the authoritative fire is out.
    this.flames.reset();
    const sources: FireSource[] = [];
    for (const actor of sim.actors) {
      if (actor.damage.sunk || actor.motion.id === hiddenSourceId) continue;
      const pose = poses?.find(p => p.actor === actor)?.motion ?? actor.motion;
      const add = (local: Vec3, intensity: number, size: number, mount: boolean, phase: number, train = 0) => {
        const position = localToWorld(local, pose);
        if (position[1] <= 0) return;
        this.position.fromArray(position); this.cameraSpace.copy(this.position).applyMatrix4(camera.matrixWorldInverse);
        const depth = -this.cameraSpace.z, projection = camera.projectionMatrix.elements;
        const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
        // Include a plume-sized margin so emissions do not pop at the viewport edge.
        if (perspective && (depth + 30 < 0 || Math.abs(this.cameraSpace.x) > Math.max(0, depth) / projection[0] + 30
          || Math.abs(this.cameraSpace.y) > Math.max(0, depth) / projection[5] + 45)) return;
        const score = intensity * size / Math.max(20, this.position.distanceTo(camera.position));
        const source = { actor, position, local, pose, train, intensity, size, mount, score, phase };
        // Bounded insertion: storage and sorting never grow with the number of fires.
        const index = sources.findIndex(s => s.score < score);
        if (index >= 0) sources.splice(index, 0, source); else if (sources.length < MAX_SOURCES) sources.push(source);
        if (sources.length > MAX_SOURCES) sources.pop();
      };
      actor.damage.control.rooms.forEach((f, i) => {
        const vent = actor.definition.compartments[i].fire?.ventPosition;
        if (f.intensity > 0 && vent) add(vent, f.intensity, 4, false, i * 2.4);
      });
      actor.damage.control.mounts.forEach((f, i) => {
        if (f.intensity <= 0) return;
        const m = actor.definition.mounts[i];
        const pose = mountFrame(actor.definition, i, actor.mounts.map(m => m.train));
        add([pose.x, pose.y + m.weapon.gunhouseSize[2], pose.z], f.intensity,
          THREE.MathUtils.clamp(Math.sqrt(m.weapon.gunhouseSize[1]) * 1.6, 1.5, 5), true, i * 2.4, pose.heading);
      });
    }
    this.sourceCount = sources.length;
    const emitSmoke = dt > 0 && this.smokeTime >= .4 - 1e-9;
    if (emitSmoke) this.smokeTime = Math.max(0, this.smokeTime - Math.max(1, Math.floor((this.smokeTime + 1e-9) / .4)) * .4); // Never replay a backlog after a slow frame.
    for (const source of sources) {
      const { intensity, size, position, phase } = source;
      if (source.mount) for (let tongue = 0; tongue < 3; tongue++) {
        const flicker = .86 + .14 * Math.sin(this.time * (8 + tongue) + phase + tongue * 2);
        const width = size * (.35 + intensity * .65) * (tongue === 1 ? 1 : .65);
        const height = width * (1.5 + .7 * intensity) * flicker;
        const offset = (tongue - 1) * size * .28;
        this.position.fromArray(localToWorld([source.local[0] + Math.cos(source.train) * offset,
          source.local[1], source.local[2] + Math.sin(source.train) * offset], source.pose));
        this.position.y += height * .43;
        const flame = this.flames.emit(this.position, source.actor.motion.id);
        flame.size = width; flame.stretch = height / width; flame.life = 1;
        flame.opacity = .9 * Math.sqrt(intensity); flame.color.setRGB(1.5, 1.15, .75);
      }
      if (emitSmoke) {
        this.position.fromArray(position); this.position.y += source.mount ? size * intensity * .5 : .2;
        const puff = this.smoke.emit(this.position, source.actor.motion.id);
        puff.size = size * (.65 + intensity * .75); puff.growth = 1.4 + intensity; puff.growthDecay = .35;
        puff.life = 6; puff.fadeIn = .15; puff.opacity = .28 + intensity * .42;
        puff.velocity.set(0, 2 + intensity * 2, 0); puff.wind = .8;
        puff.angle = phase + this.time * 1.7; puff.spin = .12;
        puff.color.setRGB(.22 + (1 - intensity) * .18, .20 + (1 - intensity) * .18, .18 + (1 - intensity) * .18);
      }
    }
    this.flames.publish(camera, hiddenSourceId); this.smoke.publish(camera, hiddenSourceId);
  }
  setDensity(density: number): void { this.flames.density = density; this.smoke.density = density; }
  diagnostics() { return { sources: this.sourceCount, flames: this.flames.count, smoke: this.smoke.count, capacity: this.flames.capacity + this.smoke.capacity }; }
  reset(): void { this.flames.reset(); this.smoke.reset(); this.smokeTime = 0; this.time = 0; this.sourceCount = 0; }
  dispose(): void { this.root.removeFromParent(); this.flames.dispose(); this.smoke.dispose(); this.flameMap.dispose(); this.smokeMap.dispose(); }
}
