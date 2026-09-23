import { FloatType, REVISION } from 'three/webgpu';

type RenderTarget = { depthTexture: { type: number } | null; depthBuffer: boolean; stencilBuffer: boolean; width: number; height: number };
type TextureUtils = {
  gl: WebGL2RenderingContext;
  setupRenderBufferStorage(renderbuffer: WebGLRenderbuffer, context: { renderTarget: RenderTarget }, samples: number, multisampledRTT?: boolean): void;
};
const installed = new WeakSet<object>();

/** Three r185's WebGL fallback allocates a multisampled target's depth renderbuffer as 24-bit even
 * when the target's depth texture is float (it compares `FloatType` with `gl.FLOAT`). Reversed depth
 * makes the scene pass's depth float, so the end-of-pass resolve blit mixes formats, fails, and
 * leaves the whole frame black; viewport depth copies fail the same way. Re-specify that
 * renderbuffer as 32-bit float, which is what the texture it resolves into holds. */
export function installWebGLFloatDepth(value: object): void {
  const backend = value as { isWebGLBackend?: boolean; textureUtils?: TextureUtils };
  const utils = backend.textureUtils;
  if (REVISION !== '185' || !backend.isWebGLBackend || !utils || installed.has(value)) return;
  const setup = utils.setupRenderBufferStorage;
  utils.setupRenderBufferStorage = function (renderbuffer, context, samples, multisampledRTT = false) {
    setup.call(this, renderbuffer, context, samples, multisampledRTT);
    const { depthTexture, depthBuffer, stencilBuffer, width, height } = context.renderTarget;
    if (samples > 0 && !multisampledRTT && depthBuffer && !stencilBuffer && depthTexture?.type === FloatType) {
      const gl = this.gl;
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT32F, width, height);
    }
  };
  installed.add(value);
}
