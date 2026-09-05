import { Clouds } from "../state/Clouds";
/**
 * Allocation-free revisions for directly mutable cloud state. Continuous animated
 * offsets affect density consumers without invalidating temporal reconstruction.
 */
export declare class CloudInputTracker {
    densityRevision: number;
    lightingRevision: number;
    layerRevision: number;
    historyRevision: number;
    private readonly _clouds;
    private readonly _shapeInputs;
    private readonly _shapeValues;
    private readonly _lightingInputs;
    private readonly _lightingValues;
    private readonly _layerInputs;
    private readonly _layerValues;
    private readonly _lastWindDirection;
    private readonly _lastWindOffset;
    private readonly _lastGroundBounce;
    private _lastWindHeading;
    private _lastWindSpeed;
    private _lastEvolutionSpeed;
    private _lastEvolutionOffset;
    private _initialized;
    constructor(clouds: Clouds);
    /** Scan current values and advance only the revisions whose outputs changed. */
    update(): void;
    private _scan;
}
