/** Per-channel weights for the base-shape noise volume (R/G/B = Worley fBm low/mid/high frequency). */
export interface ChannelStrengths {
    /** Weight on the low-frequency Worley channel. */
    r: number;
    /** Weight on the mid-frequency Worley channel. */
    g: number;
    /** Weight on the high-frequency Worley channel. */
    b: number;
}
/** Channel weights for the dilating base-shape pass. */
export declare const BASE_CHANNEL_STRENGTHS: ChannelStrengths;
/** Channel weights for the eroding pass, sampled from the base volume at the erosion scale. */
export declare const EROSION_CHANNEL_STRENGTHS: ChannelStrengths;
