import * as THREE from 'three/webgpu';
import { CloudTemporalMaterial } from '../../materials/CloudTemporalMaterial';
import type { CloudSamplingLayout } from '../cloudSampling';
import type { CameraRayBasis } from '../../tsl/screen-ray';
/** Construction inputs for {@link CloudTemporalPass}. */
export interface CloudTemporalPassOptions {
    /** History (reconstruction) target divisor vs screen — the single cloud-res knob; march divisor derives from it. */
    historyDiv: number;
}
/**
 * Amortized reprojection pass — scatter reconstruction of the 1-of-N-per-block march (see
 * `CloudTemporalMaterial` for the resolve). Runs as a `THREE.PassNode`, MRT (`output` +
 * `hitDistHistory`). History lives in two pass-owned copy targets: `updateFrame` copies the
 * previous frame's attachments into them before the pass re-renders, and the material samples
 * only those copies.
 */
export declare class CloudTemporalPass {
    /** The reconstruction material. `updateFrame` writes its per-frame uniforms. */
    readonly material: CloudTemporalMaterial;
    private _historyDiv;
    /** History (reconstruction) divisor vs screen (default 2). After setting, call `resize()` then `clearHistory()`. */
    get historyDiv(): number;
    set historyDiv(v: number);
    /** PassNode wrapping the temporal blend (MRT, two color attachments). */
    readonly passNode: THREE.PassNode;
    /** TextureNode for the blended color attachment (just-written slot). */
    readonly outputTextureNode: THREE.TextureNode;
    /** Reconstructed distance attachment: `.r` is consumer depth, `.g` is carried reprojection depth. */
    readonly hitDistTextureNode: THREE.TextureNode;
    private readonly _scene;
    private readonly _mesh;
    private readonly _historyOutput;
    private readonly _historyHitDist;
    private readonly _prevViewProjection;
    private readonly _currentViewProjection;
    private readonly _prevCameraPos;
    private readonly _prevQuaternion;
    private _historyIsClear;
    private _historyInvalidated;
    /** Keep the copy-only history targets aligned with the pass MRT attachments. */
    private _syncHistoryTargetSizes;
    constructor(cloudSourceNode: any, cloudHitDistNode: any, width: number, height: number, options: CloudTemporalPassOptions, rayBasis: CameraRayBasis);
    /** Width of one history attachment (post-resolution-scale). */
    get historyWidth(): number;
    get historyHeight(): number;
    /** Cache the actual march/history target sizes after a sampling-layout change. */
    setSamplingSizes(sourceWidth: number, sourceHeight: number, historyWidth: number, historyHeight: number): void;
    /** Starts/stops the resolve. `false` leaves the output target holding whatever it last drew. */
    setRenderEnabled(enabled: boolean): void;
    /** Reject the previous reconstruction on the next rendered frame. Repeated calls coalesce. */
    invalidateHistory(): void;
    /** Per-frame history snapshot + uniform refresh; call before this pass renders. */
    updateFrame(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, unjitteredProjection: THREE.Matrix4, sampling: CloudSamplingLayout): void;
    /** Drop accumulated history after a resize / res change (old samples sit on the wrong grid). One warm-up frame follows. */
    clearHistory(renderer: THREE.WebGPURenderer): void;
    /** Resize the reconstruction target and its two history copies in one transaction. */
    resize(width: number, height: number, pixelRatio: number): void;
    dispose(): void;
}
