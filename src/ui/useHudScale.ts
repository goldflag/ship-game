import { useEffect, useState } from 'react';
import { hudScaleFor, type HudSettings } from '../game/hudSettings';

export function useHudScale(settings: HudSettings): number {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);
  return hudScaleFor(settings, viewport.width, viewport.height);
}
