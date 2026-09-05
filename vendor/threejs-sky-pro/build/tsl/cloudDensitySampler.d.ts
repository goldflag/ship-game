import { Clouds } from "../state/Clouds";
import { CloudQuality } from "../state/CloudQuality";
type Node = any;
/** Inputs to {@link createDensitySampler}. Positions are world-space meters. */
export interface DensitySamplerOptions {
    cloud: Clouds;
    /** Construction-time graph choice: include wind drift/evolution coordinates. */
    animatedClouds: boolean;
    quality: CloudQuality;
    /** Per-frame planet center + radius — the shell-height-fraction frame. */
    planetCenter: Node;
    planetRadius: Node;
    /** Cloud-noise `texture()` nodes. */
    weatherNode: Node;
    baseNode: Node;
}
export interface PrimaryDensityCandidate {
    /** Base-only upper bound used for the coarse occupancy test. */
    conservative: Node;
    /** Complete this candidate with erosion. */
    withErosion(): Node;
}
/** The cumulus march's density samplers, sharing one parameter bundle. */
export interface DensitySampler {
    /** Full primary density at `position`; `rayDistance` is meters along the normalized view ray. */
    primary(position: Node, shellHeightFraction: Node, rayDistance: Node): Node;
    /** Stage a primary sample for a conservative test and possible erosion. */
    primaryCandidate(position: Node, shellHeightFraction: Node, rayDistance: Node): PrimaryDensityCandidate;
    full(position: Node): Node;
    cheap(position: Node): Node;
    /** Unclamped shell height fraction (0 = base, 1 = top) at a world position. */
    shellHeightFractionAt(position: Node): Node;
    /** Freeze the light-cone LOD from a primary sample's cone footprint (world meters).
     *  `cheap` must match the runtime condition the caller will use to choose between
     *  `cheap()`/`full()` right after, so the erosion LOD is only computed when needed. */
    freezeLightLodAt(footprint: Node, cheap: Node): void;
}
/** Build the density samplers for one cumulus march; must run inside the outer color-node `Fn` body. */
export declare function createDensitySampler(opts: DensitySamplerOptions): DensitySampler;
export {};
