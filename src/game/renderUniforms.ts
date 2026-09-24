import type { UniformGroupNode } from 'three/webgpu';
import { objectGroup, renderGroup } from 'three/tsl';

type Grouped = { setGroup(group: UniformGroupNode): unknown; node?: { setGroup?(group: UniformGroupNode): unknown } | null };
/** Weakly: a game's uniforms go with it. */
let nodes: WeakRef<Grouped>[] = [];
let enabled = true;

/** `node` in three's render group: a uniform the game sets between renders (the sky, the fog, the sun's shadow focus, the sea
 * fields a hull's paint reads), one value for every draw of a render. Three compares and uploads the render group once per render
 * (and per compute dispatch), in one buffer the materials that read the same render uniforms share. Left in its object group, every
 * draw of every material that reads it compares it and, when it moves, writes it into a buffer of its own: in a 30-ship battle,
 * ~5,900 of the object groups' ~8,900 compares a frame were these. A value changed during a render would reach only the draws
 * after the render's first, so only values set outside renders belong here. Takes a uniform, a uniform array or a `reference`. */
export function perRender<T>(node: T): T {
  nodes.push(new WeakRef(node as Grouped));
  if (enabled) (node as Grouped).setGroup(renderGroup);
  return node;
}

/** Off: every `perRender` uniform back in its object group, for comparison. Materials and compute kernels built from then on
 * take the new group; rebuild them (`renderer.contextNode.needsUpdate`) to compare whole frames. */
export function setPerRenderUniforms(on: boolean): void {
  enabled = on;
  const group = on ? renderGroup : objectGroup;
  nodes = nodes.filter(ref => {
    const node = ref.deref();
    if (!node) return false;
    node.setGroup(group);
    // A reference builds its uniform once and passes its group on then.
    node.node?.setGroup?.(group);
    return true;
  });
}
export const perRenderUniforms = (): { enabled: boolean; count: number } => ({ enabled, count: nodes.filter(ref => ref.deref()).length });
