/** Recalibrate Kongō's explicitly provisional loading after a hull revision. */
import {readFile, writeFile} from 'node:fs/promises';
import type {ShipBlueprint} from '../../../../src/ships/blueprint';
import {hydrostatics, initialMetacenter} from '../../../../src/simulation/hydrostatics';
const path = new URL('../blueprint.json', import.meta.url);
const b = JSON.parse(await readFile(path, 'utf8')) as ShipBlueprint;
if (!b.stability) throw new Error('Author the initial stability profile first');
const waterline = hydrostatics(b.hull);
b.stability.buoyancyScale = b.hull.massKg / (1025 * waterline.volume);
b.stability.dryCenterOfGravity = [0, initialMetacenter(b.hull)-b.hull.beam*.07, waterline.center[2]];
await writeFile(path, JSON.stringify(b, null, 2)+'\n');
