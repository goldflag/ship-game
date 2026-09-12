/** One compact condition meter for either affiliation; projection reveals it up close. */
export function PlaneHealth({ hp, name }: { hp: number | undefined; name: string }) {
  if (hp === undefined || !Number.isFinite(hp)) return null;
  const fraction = Math.max(0, Math.min(1, hp));
  return <g data-map-detail="health" className="fleet-command-plane-health" role="meter" aria-label={`${name} health`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
    <rect className="fleet-command-hull-track" x="-6" y="9" width="12" height="2"/>
    <rect className="fleet-command-hull-fill" x="-6" y="9" width={12 * fraction} height="2"/>
  </g>;
}
