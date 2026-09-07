import { createContext, useContext } from 'react';
import type { ShipDefinition } from '../ships/blueprint';
import { selectedShip } from '../ships/presets';

export const ShipContext = createContext<ShipDefinition>(selectedShip);
export const useShip = () => useContext(ShipContext);
