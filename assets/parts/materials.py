"""Shared original component palette. RGB constants are linear, as in glTF.

Role metadata survives the common exporter as material extras. Recipes choose
roles explicitly; neither the exporter nor the renderer guesses from mesh names.
Legacy edge is protected detail, not a claim that every dark fitting is bare steel.
"""
import json
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[2]
DEFINITION = json.loads((ROOT / 'assets/parts/materials.json').read_text())
FINISHES = {**json.loads((ROOT / 'assets/ships/appearance/finishes.json').read_text())['finishes'],
            **DEFINITION['finishes']}


def create_materials():
    palette = {}
    for role, spec in DEFINITION['roles'].items():
        material = bpy.data.materials.new(role)
        material.use_nodes = True
        color = (*spec['color'], 1)
        finish = FINISHES[spec['finish']]
        material.diffuse_color = color
        node = material.node_tree.nodes['Principled BSDF']
        node.inputs['Base Color'].default_value = color
        node.inputs['Roughness'].default_value = finish['roughness']
        node.inputs['Metallic'].default_value = finish['metallic']
        material['componentMaterialVersion'] = DEFINITION['schemaVersion']
        material['componentMaterialRole'] = role
        material['componentPaint'] = spec['paint']
        palette[role] = material
    return palette
