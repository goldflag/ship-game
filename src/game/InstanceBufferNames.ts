import { REVISION } from 'three/webgpu';

type Uniform = { name: string };
type Builder = {
  uniforms: { index: number }; globalCache: unknown;
  getDataFromNode(node: object, stage: string, cache: unknown): { uniform?: Uniform };
  getUniformFromNode(node: object, type: string, stage: string, name?: string | null): Uniform;
};
type Backend = {
  isWebGPUBackend?: boolean;
  createNodeBuilder?: (object: { isInstancedMesh?: boolean }, renderer: unknown) => Builder;
};
const installed = new WeakSet<object>();

/** Three r185 gives instancing buffers process-wide node IDs in WGSL. Two
 * otherwise identical pages then miss the shader/pipeline cache solely because
 * their variable names differ. Retain NodeBuilder's shader-local uniform names;
 * binding indices, buffers, declarations and update ownership stay with Three. */
export function installInstanceBufferNames(value: object): void {
  const backend = value as Backend;
  if (REVISION !== '185' || !backend.isWebGPUBackend || !backend.createNodeBuilder || installed.has(value)) return;
  const create = backend.createNodeBuilder;
  backend.createNodeBuilder = function (object, renderer) {
    const builder = create.call(this, object, renderer);
    if (!object.isInstancedMesh) return builder;
    const getUniform = builder.getUniformFromNode;
    builder.getUniformFromNode = function (node, type, stage, name) {
      if (!name && (type === 'buffer' || type === 'storageBuffer' || type === 'indirectStorageBuffer')) {
        name = this.getDataFromNode(node, stage, this.globalCache).uniform?.name ?? `nodeUniform${this.uniforms.index}`;
      }
      return getUniform.call(this, node, type, stage, name);
    };
    return builder;
  };
  installed.add(value);
}
