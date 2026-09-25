import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONSTRUCTION_FINISH } from '../../src/ships/constructionPaints';
import { shipPresets } from '../../src/ships/presets';

const finishes = JSON.parse(readFileSync('assets/ships/appearance/finishes.json', 'utf8')).finishes;

describe('published fleet appearance', () => {
  for (const id of Object.keys(shipPresets)) {
    test(`${id}: shared finishes and their UVs survive the actual GLB export`, () => {
      const bytes = readFileSync(`public/models/${id}.glb`);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      if (shipPresets[id].hull.kind === 'constructed-volume-v1') {
        // Painted coatings are named construction.<paint>:<deck>; propeller shafts (construction.propeller.*) are bare steel.
        const hullMaterials = gltf.materials.filter((m: any) => /^construction\.[^.]+:(true|false)$/.test(m.name ?? ''));
        expect(hullMaterials.length).toBeGreaterThan(0);
        for (const material of hullMaterials) {
          const pbr = material.pbrMetallicRoughness;
          expect(pbr.metallicFactor ?? 1).toBe(CONSTRUCTION_FINISH.metalness);
          expect(pbr.roughnessFactor ?? 1).toBeCloseTo(material.name.endsWith(':true') ? CONSTRUCTION_FINISH.deckRoughness : CONSTRUCTION_FINISH.steelRoughness, 5);
          expect(pbr.baseColorTexture).toBeDefined();
          for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
            if (gltf.materials[primitive.material] !== material) continue;
            expect(gltf.accessors[primitive.attributes.TEXCOORD_0]?.count).toBe(gltf.accessors[primitive.attributes.POSITION].count);
          }
        }
        return;
      }
      const spec = JSON.parse(readFileSync(`assets/ships/${id}/appearance.json`, 'utf8'));
      const inputs = JSON.parse(readFileSync(`assets/ships/${id}/recipe-inputs.json`, 'utf8'));
      for (const file of ['assets/ships/appearance/surface.py', 'assets/ships/appearance/finishes.json', `assets/ships/${id}/appearance.json`]) {
        expect(inputs.files).toContain(file);
      }
      expect(gltf.scenes[gltf.scene ?? 0].extras.appearanceId).toBe(spec.id);
      let painted = 0;
      for (const material of gltf.materials) {
        if (!material.extras?.surfaceFinish) continue;
        painted++;
        const finish = finishes[material.extras.surfaceFinish];
        expect(finish).toBeDefined();
        expect(material.extras.paintId).toBeTruthy();
        const pbr = material.pbrMetallicRoughness;
        expect(pbr.roughnessFactor ?? 1).toBeCloseTo(finish.roughness, 5);
        expect(pbr.metallicFactor ?? 1).toBe(finish.metallic);
        expect(pbr.baseColorTexture).toBeDefined();
        for (const value of pbr.baseColorFactor ?? [1, 1, 1, 1]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
      expect(painted).toBeGreaterThanOrEqual(3);
      for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
        const material = gltf.materials[primitive.material];
        if (!material?.extras?.surfaceFinish) continue;
        const texture = material.pbrMetallicRoughness.baseColorTexture;
        const uvIndex = texture.extensions?.KHR_texture_transform?.texCoord ?? texture.texCoord ?? 0;
        const accessor = gltf.accessors[primitive.attributes[`TEXCOORD_${uvIndex}`]];
        expect(accessor).toBeDefined();
        expect(accessor.count).toBe(gltf.accessors[primitive.attributes.POSITION].count);
        if (material.normalTexture) {
          const normalUV = material.normalTexture.texCoord ?? 0;
          expect(normalUV).toBeGreaterThanOrEqual(0);
          expect(gltf.accessors[primitive.attributes[`TEXCOORD_${normalUV}`]]?.count)
            .toBe(gltf.accessors[primitive.attributes.POSITION].count);
        }
      }
      // One wear standard: the preset the game weathers the ship by, and no baked hull runoff or tide stain.
      expect(gltf.scenes[gltf.scene ?? 0].extras.appearanceWear).toBe(spec.wear ?? 'in-commission');
      expect(spec.hull).toBeUndefined();
      // One deck standard: every timber role is a declared weather deck the game planks, or declared fittings.
      for (const [role, binding] of Object.entries<any>(spec.materials)) {
        if (binding.finish === 'wood') expect([role, role in (spec.decking ?? {})]).toEqual([role, !binding.fittings]);
        expect(binding.projection).toBeUndefined();
      }
      for (const role of Object.keys(spec.decking ?? {})) {
        const deck = spec.decking[role];
        const deckMaterials = gltf.materials.filter((m: any) => m.extras?.paintId === spec.materials[role].paint);
        expect(deckMaterials.length).toBeGreaterThan(0);
        for (const material of deckMaterials) {
          expect(material.extras.deckSubstrate).toBe('timber');
          expect(material.extras.surfaceFinish).toBe('wood');
          // The game draws the planks: no baked plank relief.
          expect(material.normalTexture).toBeUndefined();
          expect(material.extras.deckCoating).toBe(deck.coating);
          expect([material.extras.deckPlankWidth, material.extras.deckPlankLength, material.extras.deckSeamWidth]).toEqual([deck.plankWidth, deck.plankLength, deck.seamWidth]);
          expect(material.extras.deckModeled ?? false).toBe(deck.modeled ?? false);
        }
        const steelRoofs = gltf.materials.filter((m: any) => m.extras?.paintId === spec.materials.roof.paint);
        for (const material of steelRoofs) {
          expect(material.extras.surfaceFinish).toBe('painted-deck');
          expect(material.extras.deckSubstrate).toBeUndefined();
        }
      }
      for (const material of gltf.materials) {
        if (/glass|glazing|bronze|ensign|flag/i.test(material.name ?? '')) {
          expect(material.extras?.surfaceFinish).toBeUndefined();
        }
      }
    });
  }
});
