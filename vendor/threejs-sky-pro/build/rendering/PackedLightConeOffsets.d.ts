import * as THREE from 'three';
/**
 * CPU-built light-cone offsets for one directional light. Each node is one aligned
 * `vec4(offset.xyz, stepLength)` uniform for taps 1..N-1; tap 0 reuses primary density.
 */
export declare class PackedLightConeOffsets {
    /** TSL uniforms consumed directly by the unrolled light march. */
    readonly nodes: readonly any[];
    /** Compile-time tap count represented by this uniform set, including the reused origin tap. */
    readonly taps: number;
    private readonly _values;
    private readonly _lastDirection;
    private _lastStepSize;
    private _lastConeSpread;
    private readonly _seed;
    private readonly _direction;
    private readonly _tangent;
    private readonly _bitangent;
    private readonly _offset;
    constructor(taps: number);
    /** Rebuild the packed offsets only when direction or cone geometry changed. */
    update(direction: THREE.Vector3, stepSize: number, coneSpread: number): boolean;
}
