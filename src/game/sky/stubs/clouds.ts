import { Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { float, vec4 } from 'three/tsl';
import type { CloudPart } from '../contracts';
import { CLOUD_ORDER, fullScreenTriangle } from '../dome';

/** No clouds: an invisible composite, a clear bake and full sun. */
export function createStubClouds(): CloudPart {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.fog = false;
  material.colorNode = vec4(0, 0, 0, 0);
  const composite = new Mesh(fullScreenTriangle(), material);
  composite.name = 'Cloud composite';
  composite.visible = false;
  composite.frustumCulled = false;
  composite.renderOrder = CLOUD_ORDER;
  return {
    enabled: true,
    composite,
    screenTransmittance: null,
    apply() {},
    cirrus: (_direction, behind) => behind,
    bake: () => vec4(0, 0, 0, 1),
    shadow: () => float(1),
    update() {},
    setQuality() {},
    dispose() { material.dispose(); composite.geometry.dispose(); },
  };
}
