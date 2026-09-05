/** Sampling lattices selected by the construction-time cloud rendering mode. */
export type CloudSamplingLattice = 2 | 4;
/** One position in a square temporal sampling lattice. */
export interface SamplingCell {
    x: number;
    y: number;
}
/** Actual pixel sizes of the display, cloud march, and temporal-history targets. */
export interface CloudSamplingTargetSizes {
    screenWidth: number;
    screenHeight: number;
    sourceWidth: number;
    sourceHeight: number;
    historyWidth: number;
    historyHeight: number;
}
/** Shared resolution and temporal sampling state for the cloud march and reconstruction. */
export declare class CloudSamplingLayout {
    private _historyDiv;
    readonly lattice: CloudSamplingLattice;
    private readonly _freshCell;
    private _screenWidth;
    private _screenHeight;
    private _sourceWidth;
    private _sourceHeight;
    private _historyWidth;
    private _historyHeight;
    constructor(historyDiv: number, lattice: CloudSamplingLattice);
    get historyDiv(): number;
    /** Returns true when the layout changed. */
    setHistoryDiv(value: number): boolean;
    /** Raymarch divisor derived from reconstruction resolution and the mode's lattice. */
    get sourceDiv(): number;
    /** Frames required to refresh every position in the active lattice. */
    get period(): number;
    /** Advance the shared fresh cell once; both passes read this exact object afterward. */
    updateFrame(frameIndex: number): void;
    get freshCell(): Readonly<SamplingCell>;
    /** Store the actual post-rounding target sizes after the owning passes resize. */
    setTargetSizes(sizes: CloudSamplingTargetSizes): void;
    get screenWidth(): number;
    get screenHeight(): number;
    get sourceWidth(): number;
    get sourceHeight(): number;
    get historyWidth(): number;
    get historyHeight(): number;
}
