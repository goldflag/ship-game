"""Original flagstaff components and articulated sensor ownership. Blender frame."""
import bpy
from mathutils import Vector


def radar_pivot(node_id, position, objects):
    """Keep authored world poses while assigning only rotating pieces to a joint."""
    bpy.context.view_layer.update()
    node = bpy.data.objects.new(node_id, None)
    bpy.context.scene.collection.objects.link(node)
    node.location = position
    node['nodeId'] = node_id
    node['assemblyId'] = node_id.rsplit('.', 1)[0]
    bpy.context.view_layer.update()
    for obj in objects:
        world = obj.matrix_world.copy()
        obj.parent = node
        obj.matrix_world = world
    return node


def create_flagstaffs(definition):
    material = bpy.data.materials.new('Original ensign staff')
    material.diffuse_color = (.25, .28, .29, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Roughness'].default_value = .8
    for flag in definition.get('rig', {}).get('ensigns', []):
        x, y, z = flag['position']
        top = Vector((-z, -x, y))
        socket = bpy.data.objects.new(flag['id'] + '.hoist', None)
        bpy.context.scene.collection.objects.link(socket)
        socket.location = top
        socket['nodeId'] = flag['id'] + '.hoist'
        socket['assemblyId'] = flag['id']
        height = flag['staffHeight']
        if not height:  # A retained original staff already supports this hoist.
            continue
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=.05, radius2=.025,
            depth=height + .12, location=top - Vector((0, 0, height / 2 - .06)))
        staff = bpy.context.object
        staff.name = flag['id'] + '.staff'
        staff['assemblyId'] = flag['id']
        staff.data.materials.append(material)
