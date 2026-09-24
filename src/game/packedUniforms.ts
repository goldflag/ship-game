import { Vector4, type Node, type UniformGroupNode } from 'three/webgpu';
import { uniformArray } from 'three/tsl';

/** Several vec4 uniform arrays in one uniform buffer. Three gives every uniform array a buffer of its own, and a
 * WebGPU shader stage may bind only 12 uniform buffers by default: the ocean surface reads the trail foam, the bow
 * waves, the hull contact foam and the sea around hulls in one fragment shader, so their arrays pack here. Each
 * section keeps its own Vector4s, which the CPU sets in place; shaders read section `s` at `index`. */
export class PackedVec4Arrays {
  readonly node;
  /** Each section's values, in the order of the lengths given. */
  readonly sections: readonly Vector4[][];
  private readonly offsets: number[] = [];

  /** `group` is the uniform group the buffer updates with (three's object group when omitted); `place`, when given, places the
   * buffer's node instead (`perRender`). */
  constructor(lengths: readonly number[], group?: UniformGroupNode, place?: <T>(node: T) => T) {
    const values: Vector4[] = [];
    this.sections = lengths.map(length => {
      this.offsets.push(values.length);
      const section = Array.from({ length }, () => new Vector4());
      values.push(...section);
      return section;
    });
    this.node = uniformArray<'vec4'>(values, 'vec4');
    if (group) this.node.setGroup(group);
    if (place) place(this.node);
  }

  /** Section `section`'s element at `index`. */
  element(section: number, index: Node<'int'> | number) {
    const offset = this.offsets[section];
    return this.node.element(typeof index === 'number' ? offset + index : offset ? index.add(offset) : index);
  }
}
