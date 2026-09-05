type Node = any;
/** Top-down ortho projection shared by the shadow bake and every sampler. */
export interface CloudShadowProjection {
    /** World point the map centers on (camera XZ at ground reference altitude). */
    center: Node;
    /** Constant world horizontal axis (+X). */
    axisU: Node;
    /** Constant world horizontal axis (+Z). */
    axisV: Node;
    /** Half-width of the XZ footprint in meters. */
    extent: Node;
    /** Shadow strength (0 = no shadow, 1 = full). */
    intensity: Node;
    /** Master enable (1 = shadows cast, 0 = disabled → factor returns 1.0). */
    enabled: Node;
}
/** Sample the baked cloud shadow map (1 = full sun, 0 = shadowed; fades to 1.0 near/beyond the footprint edge). */
export declare function cloudShadowFactor(worldPos: Node, shadowTexture: Node, projection: CloudShadowProjection): Node;
export {};
