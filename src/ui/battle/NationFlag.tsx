import type { ReactNode } from 'react';

/** Simplified civil flags at instrument size. Wartime naval ensigns are deliberately not drawn. */
const FLAGS: Record<string, { label: string; draw: () => ReactNode }> = {
  'United States': { label: 'USA', draw: () => <><rect width="24" height="16" fill="#f2f2f2"/><g fill="#b8352f">{[0, 2.5, 4.9, 7.4, 9.8, 12.3, 14.7].map(y => <rect key={y} y={y} width="24" height="1.3"/>)}</g><rect width="10.5" height="8.7" fill="#2f4a7a"/></> },
  'United Kingdom': { label: 'UK', draw: () => <><rect width="24" height="16" fill="#2f4a7a"/><path d="M0 0L24 16M24 0L0 16" stroke="#f2f2f2" strokeWidth="3.2"/><path d="M0 0L24 16M24 0L0 16" stroke="#b8352f" strokeWidth="1.1"/><path d="M12 0V16M0 8H24" stroke="#f2f2f2" strokeWidth="4.4"/><path d="M12 0V16M0 8H24" stroke="#b8352f" strokeWidth="2.4"/></> },
  Germany: { label: 'Germany', draw: () => <><rect width="24" height="5.34" fill="#222"/><rect y="5.33" width="24" height="5.34" fill="#b8352f"/><rect y="10.66" width="24" height="5.34" fill="#e2b93b"/></> },
  Japan: { label: 'Japan', draw: () => <><rect width="24" height="16" fill="#f2f2f2"/><circle cx="12" cy="8" r="4.6" fill="#c0392b"/></> },
  Canada: { label: 'Canada', draw: () => <><rect width="24" height="16" fill="#f2f2f2"/><rect width="6" height="16" fill="#b8352f"/><rect x="18" width="6" height="16" fill="#b8352f"/><path d="M12 3.2l1 2.2 1.6-.6-.5 2.4 1.8.4-1.3 1.5.6 1.3-2.2-.4-.2 2.6h-1.6l-.2-2.6-2.2.4.6-1.3-1.3-1.5 1.8-.4-.5-2.4 1.6.6z" fill="#b8352f"/></> },
};
export const nationLabel = (nation: string) => FLAGS[nation]?.label ?? nation;
export function NationFlag({ nation, width = 15 }: { nation: string; width?: number }) {
  const flag = FLAGS[nation];
  if (!flag) return null;
  return <svg className="nation-flag" width={width} height={width * 2 / 3} viewBox="0 0 24 16" aria-hidden="true">{flag.draw()}</svg>;
}
