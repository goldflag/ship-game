import type { CreateWakeField } from '../contracts';
import { calmWake } from './calm';
import { WakeField } from './WakeField';

/** A dispersive wake field, or a calm one on tiers that simulate no wake (resolution 0). */
export const createWakeField: CreateWakeField = (renderer, resolution) => resolution > 0 ? new WakeField(renderer, resolution) : calmWake();
