import * as THREE from 'three';
import type { ConstructionSurface } from '../../../ships/blueprint';
import type { BuilderPick, BuilderScene } from '../builderScene';
import type { EquipmentPreview } from '../equipmentPreview';
import { pointerRay } from './resources';

export interface ArmorReading {
  title: string;
  detail: string;
}
export interface ArmorView {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: BuilderScene;
  equipment: EquipmentPreview;
  hullMeshes: THREE.Object3D[];
  surfacesByKey: Map<string, ConstructionSurface[]>;
  /** A press that is not laying pieces; turrets are not read during it. */
  navigating: boolean;
}

/** Show `armor` beside the pointer, kept inside the overlay; hide the tooltip without one. */
export function placeArmorTooltip(overlay: HTMLElement, event?: { clientX: number; clientY: number }, armor?: ArmorReading) {
  const tooltip = overlay.querySelector<HTMLElement>('[data-armor-tooltip]')!;
  tooltip.hidden = !armor || !event;
  if (!armor || !event) return;
  tooltip.querySelector('b')!.textContent = armor.title;
  tooltip.querySelector('span')!.textContent = armor.detail;
  const bounds = overlay.getBoundingClientRect();
  let x = event.clientX - bounds.left + 16,
    y = event.clientY - bounds.top + 18;
  if (x + tooltip.offsetWidth > bounds.width - 8) x = event.clientX - bounds.left - tooltip.offsetWidth - 16;
  if (y + tooltip.offsetHeight > bounds.height - 8) y = event.clientY - bounds.top - tooltip.offsetHeight - 18;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

/** The hull face under the pointer, or a turret plate in front of it: turrets carry fixed catalog armor. */
export function armorReading(view: ArmorView, event: { clientX: number; clientY: number }, pick?: BuilderPick): ArmorReading | undefined {
  const ray = pointerRay(event, view.canvas, view.camera);
  const turret =
    view.navigating || view.scene.measuring
      ? undefined
      : view.equipment.armorHit(ray, view.scene.source, view.scene.catalog);
  const hull = ray.intersectObjects(view.hullMeshes, false)[0];
  if (turret && (!hull || turret.distance <= hull.distance))
    return {
      title: `${turret.plated ? 'Gunhouse plate' : 'Mount armor'}: ${turret.thicknessMm.toLocaleString()} mm`,
      detail: `${turret.name} · fixed by the gun`,
    };
  const surface = pick?.surface ? view.surfacesByKey.get(pick.surface)?.[0] : undefined;
  return (
    surface && {
      title: surface.open ? 'Open to sea' : `Nominal armor: ${surface.thicknessMm.toLocaleString()} mm`,
      detail: surface.open ? 'No protective plate' : surface.material === 'armor-steel' ? 'Armor steel' : 'Structural steel',
    }
  );
}
