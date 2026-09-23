import type { CreateWakeField } from '../contracts';
import { WakeField } from './WakeField';

export const createWakeField: CreateWakeField = (renderer, resolution) => new WakeField(renderer, resolution);
