import kingGeorgeV from '../../public/models/king-george-v.json';
import bismarck from '../../public/models/bismarck.json';
import yamato from '../../public/models/yamato.json';
import iowa from '../../public/models/iowa.json';
import baltimore from '../../public/models/baltimore.json';
import mogami from '../../public/models/mogami.json';
import enterprise from '../../public/models/enterprise-cv6.json';
import shokaku from '../../public/models/shokaku.json';
import viic from '../../public/models/type-viic.json';
import fletcher from '../../public/models/fletcher.json';
import yukikaze from '../../public/models/yukikaze.json';
import libertyCargo from '../../public/models/liberty-cargo.json';
import libertyCollier from '../../public/models/liberty-collier.json';
import victoryCargo from '../../public/models/victory-cargo.json';
import flower from '../../public/models/flower-corvette.json';
import type { ShipDefinition } from './blueprint';

/** Historical presets share the same compiled definition and renderer contract. */
export const shipPresets = {
  bismarck,
  yamato,
  iowa,
  'king-george-v': kingGeorgeV,
  baltimore,
  mogami,
  'enterprise-cv6': enterprise,
  shokaku,
  'type-viic': viic,
  'liberty-cargo': libertyCargo,
  'liberty-collier': libertyCollier,
  'victory-cargo': victoryCargo,
  'flower-corvette': flower,
  fletcher,
  yukikaze,
};
const retiredPresetAliases: Record<string, keyof typeof shipPresets> = {
  'liberty-deck-cargo': 'liberty-collier', 'liberty-troopship': 'victory-cargo',
};
export function shipPreset(id: string | null): ShipDefinition & { contentHash: string } {
  if (id && Object.hasOwn(retiredPresetAliases, id)) id = retiredPresetAliases[id];
  return (id && Object.hasOwn(shipPresets, id) ? shipPresets[id as keyof typeof shipPresets] : bismarck) as ShipDefinition & { contentHash: string };
}
export const selectedShip = shipPreset(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('ship'));
