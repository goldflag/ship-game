import { createContext, useContext } from 'react';
import { selectedShip } from '../ships/presets';

export const ShipContext = createContext(selectedShip);
export const useShip = () => useContext(ShipContext);
