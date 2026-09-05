import type { CSSProperties } from 'react';
export function Icon({ name, size = 20, style }: { name: 'anchor' | 'pause' | 'play' | 'camera' | 'expand' | 'close' | 'arrow' | 'compass' | 'he' | 'shell' | 'repair' | 'ship' | 'turret' | 'target' | 'plus' | 'minus'; size?: number; style?: CSSProperties }) {
  const paths = {
    anchor: <><circle cx="12" cy="5" r="2"/><path d="M12 7v14M7 11h10M3 14v3c0 2 5 4 9 4s9-2 9-4v-3M3 14l3 2M21 14l-3 2"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    play: <path d="m8 4 12 8-12 8Z"/>,
    camera: <><path d="M3 7h5l2-3h4l2 3h5v13H3Z"/><circle cx="12" cy="13" r="4"/></>,
    expand: <path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/></>,
    he: <path d="M8 20V10l4-7 4 7v10ZM8 15h8M8 18h8M8 10h8"/>,
    shell: <><path d="M9 20V9c0-3 3-6 3-6s3 3 3 6v11ZM9 15h6M9 18h6M7 21h10"/></>,
    repair: <path d="m5 20 8-8a6 6 0 0 0 7-7l-4 4-3-3 4-4a6 6 0 0 0-7 7l-8 8Z"/>,
    ship: <path d="m2 16 3 5h13l4-5H2ZM6 16v-4h11v4M10 12V8h4v4M12 8V3m0 2h5"/>,
    turret: <path d="M5 20V12l3-3h8l3 3v8ZM9 9V2m6 7V2M3 21h18M8 16h8"/>,
    target: <><path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/><circle cx="12" cy="12" r="3"/></>,
    plus: <path d="M5 12h14M12 5v14"/>,
    minus: <path d="M5 12h14"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
