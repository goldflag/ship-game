/**
 * What pinned three r185's WebGPU backend leaves in an attribute's GPU buffer, and what it writes to get there, modelled on the CPU
 * so tests can check an effect's uploads without a GPU. It follows `Geometries.updateAttributes` (one update per attribute per render
 * call), `Attributes.update` (the first use creates the buffer from the whole array; later ones upload when the version moved, or on
 * every call for `DynamicDrawUsage`) and `WebGPUAttributeUtils.updateAttribute` (the flagged ranges, or the whole array when none, then
 * the ranges are cleared). `moveInstances` stands in for a GPU-side copy between instances of the same buffers.
 */
import { DynamicDrawUsage, type BufferAttribute, type InterleavedBufferAttribute, type TypedArray } from 'three/webgpu';
import type { InstanceMoves } from '../WakeFoamGpu';

type Attribute = BufferAttribute | InterleavedBufferAttribute;
interface Copy { data: TypedArray; version: number }

export class GpuUploadModel {
  /** Bytes and `writeBuffer` calls the uploads made (buffer creation copies at mapping, not through `writeBuffer`). */
  bytes = 0;
  writes = 0;
  /** Bytes moved on the GPU by `moveInstances`. */
  moved = 0;
  private readonly copies = new Map<object, Copy>();

  /** One render call that draws `attributes` (each updated at most once, as three's per-call guard allows). */
  render(attributes: readonly Attribute[]): void {
    for (const attribute of new Set(attributes)) {
      const buffer = 'isInterleavedBufferAttribute' in attribute && attribute.isInterleavedBufferAttribute ? attribute.data : attribute as BufferAttribute;
      const copy = this.copies.get(buffer);
      if (!copy) { this.copies.set(buffer, { data: buffer.array.slice() as TypedArray, version: buffer.version }); continue; }
      if (copy.version >= buffer.version && buffer.usage !== DynamicDrawUsage) continue;
      const array = buffer.array as TypedArray;
      if (!buffer.updateRanges.length) { copy.data.set(array); this.bytes += array.byteLength; this.writes++; }
      else {
        for (const { start, count } of buffer.updateRanges) {
          copy.data.set(array.subarray(start, start + count), start);
          this.bytes += count * array.BYTES_PER_ELEMENT; this.writes++;
        }
        buffer.clearUpdateRanges();
      }
      copy.version = buffer.version;
    }
  }

  /** The GPU buffer's contents, or undefined before the attribute's first render. */
  gpu(attribute: Attribute): TypedArray | undefined {
    const buffer = 'isInterleavedBufferAttribute' in attribute && attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
    return this.copies.get(buffer)?.data;
  }

  /** A mover for `WakeFoamGpu`: copies runs of instances within each attribute's GPU buffer, through a scratch copy as a GPU would. */
  readonly moveInstances: InstanceMoves = (attributes, moves) => {
    if (attributes.some(attribute => !this.copies.has(attribute))) return false;
    for (const attribute of attributes) {
      const data = this.copies.get(attribute)!.data, size = attribute.itemSize;
      const scratch = moves.map(({ from, count }) => data.slice(from * size, (from + count) * size));
      moves.forEach(({ to }, i) => { data.set(scratch[i], to * size); this.moved += scratch[i].byteLength; });
    }
    return true;
  };
}

/** Whether the first `count` values of the GPU copy equal the CPU array, word for word. */
export function sameWords(gpu: TypedArray | undefined, cpu: TypedArray, count: number): boolean {
  if (!gpu) return false;
  const a = new Uint32Array(gpu.buffer, gpu.byteOffset, count * gpu.BYTES_PER_ELEMENT / 4);
  const b = new Uint32Array(cpu.buffer, cpu.byteOffset, count * cpu.BYTES_PER_ELEMENT / 4);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
