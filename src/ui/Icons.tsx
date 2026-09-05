import type { CSSProperties } from 'react';
export function Icon({ name, size = 20, style }: { name: 'anchor' | 'pause' | 'play' | 'camera' | 'expand' | 'close' | 'arrow' | 'compass'; size?: number; style?: CSSProperties }) {
  const paths = {
    anchor: <><circle cx="12" cy="5" r="2"/><path d="M12 7v14M7 11h10M3 14v3c0 2 5 4 9 4s9-2 9-4v-3M3 14l3 2M21 14l-3 2"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    play: <path d="m8 4 12 8-12 8Z"/>,
    camera: <><path d="M3 7h5l2-3h4l2 3h5v13H3Z"/><circle cx="12" cy="13" r="4"/></>,
    expand: <path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
