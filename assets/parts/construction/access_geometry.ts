/** Original metric access fittings. Endpoints are deck contacts (stairs) or wall
 * contacts (framed ladder). Sections are physical, never scaled sample meshes. */
export type Point = [number, number, number];
export type AccessKind = 'inclined-ladder' | 'framed-ladder';
export type Handrails = 'both' | 'left' | 'right' | 'none';
export interface AccessSettings { widthM: number; standOffM: number; handrails: Handrails; grabHeightM: number }
export interface AccessMember { name: string; a: Point; b: Point; width: number; depth: number; round?: boolean }
export interface AccessLayout { members: AccessMember[]; anchors: Point[]; count: number; spacingM: number; angleDeg: number }
const add = (a: Point, b: Point): Point => a.map((v, i) => v + b[i]) as Point;
const sub = (a: Point, b: Point): Point => a.map((v, i) => v - b[i]) as Point;
const mul = (a: Point, s: number): Point => a.map(v => v * s) as Point;
const lerp = (a: Point, b: Point, t: number) => add(a, mul(sub(b, a), t));
export const isAccessKind = (kind?: string): kind is AccessKind => kind === 'inclined-ladder' || kind === 'framed-ladder';
export const accessDefaults = (kind: AccessKind): AccessSettings => ({ widthM: kind === 'inclined-ladder' ? .75 : .5, standOffM: .2, handrails: 'both', grabHeightM: .9 });
export function accessLayout(kind: AccessKind, points: readonly Point[], settings: AccessSettings, project?: (p: Point) => Point | undefined): AccessLayout | undefined {
  const { widthM: width, standOffM: stand, handrails, grabHeightM: grab } = settings;
  if (points.length !== 2 || points.some(p => p.some(v => !Number.isFinite(v) || Math.abs(v) > 1000))
    || !Number.isFinite(width) || width < .35 || width > 1.5 || !Number.isFinite(stand) || stand < .12 || stand > .4
    || !Number.isFinite(grab) || grab < 0 || grab > 1.2 || !['both', 'left', 'right', 'none'].includes(handrails)) return;
  let [a, b] = points;
  if (b[1] < a[1]) [a, b] = [b, a];
  const delta = sub(b, a), rise = delta[1], run = Math.hypot(delta[0], delta[2]);
  if (rise < .5 || rise > 12) return;
  const members: AccessMember[] = [], anchors: Point[] = [];
  const member = (name: string, a: Point, b: Point, width: number, depth = width, round = false) => members.push({ name, a, b, width, depth, ...(round ? { round: true } : {}) });
  if (kind === 'inclined-ladder') {
    const angle = Math.atan2(rise, run) * 180 / Math.PI;
    if (angle < 30 || angle > 75 || run < .4) return;
    const forward = mul([delta[0], 0, delta[2]], 1 / run), right: Point = [-forward[2], 0, forward[0]];
    const top = add(b, mul(forward, -.28));
    const stepCount = Math.ceil(rise / .24), going = (run - .28) / stepCount;
    const treadDepth = Math.min(.30, Math.max(.16, going + .035));
    const side = (p: Point, sign: number) => add(p, mul(right, sign * (width / 2 + .02)));
    for (const sign of [-1, 1]) {
      const lower = side(add(a, [0, .075, 0]), sign), upper = side(add(top, [0, -.055, 0]), sign);
      member('stringer', lower, upper, .045, .12);
      member('foot-bracket', side(add(a, [0, .016, 0]), sign), lower, .055, .08);
      for (const p of [a, b]) {
        const c = side(p, sign); anchors.push(c);
        member('deck-shoe', add(add(c, mul(forward, -.12)), [0, .016, 0]), add(add(c, mul(forward, .12)), [0, .016, 0]), .14, .032);
      }
      // A top knee joins the outboard stringer to the deck shoe without a
      // full-height support leg through the lower deck's usable space.
      member('landing-knee', upper, side(add(b, [0, .04, 0]), sign), .055, .08);
      if (handrails === 'both' || handrails === (sign < 0 ? 'left' : 'right')) {
        const n = Math.max(1, Math.ceil(Math.hypot(run, rise) / 1.35));
        for (let i = 0; i <= n; i++) {
          const base = lerp(lower, upper, i / n);
          member('stanchion', base, add(base, [0, .95, 0]), .032, .032, true);
        }
        member('handrail', add(lower, [0, .95, 0]), add(upper, [0, .95, 0]), .038, .038, true);
        member('midrail', add(lower, [0, .49, 0]), add(upper, [0, .49, 0]), .024, .024, true);
      }
    }
    for (let i = 1; i <= stepCount; i++) {
      const c = lerp(a, top, i / stepCount); c[1] -= .022;
      member('tread', add(c, mul(right, -width / 2)), add(c, mul(right, width / 2)), .044, treadDepth);
    }
    return { members, anchors, count: stepCount, spacingM: rise / stepCount, angleDeg: angle };
  }
  // Framed ladders climb a wall; their width stays horizontal.
  if (Math.abs(delta[0]) > .01 || Math.abs(delta[2]) > rise * .5) return;
  const rungCount = Math.ceil(rise / .30), brackets = Math.max(1, Math.ceil(rise / 1.5));
  const outer = (p: Point): Point => add(p, [0, 0, -stand]);
  for (const sign of [-1, 1]) {
    const foot = add(a, [sign * (width / 2 + .018), 0, 0]), head = add(b, [sign * (width / 2 + .018), 0, 0]);
    member('side-rail', outer(foot), add(outer(head), [0, grab, 0]), .036, .06);
    for (let i = 0; i <= brackets; i++) {
      const seat = lerp(foot, head, i / brackets), wall = project ? project(seat) : seat;
      if (!wall || Math.hypot(...sub(wall, seat)) > .1) return;
      anchors.push(wall);
      member('wall-bracket', wall, outer(seat), .035, .035, true);
      // Small welded vertical pad, seated on the wall face.
      const pad = add(wall, [0, 0, -.008]);
      member('wall-pad', add(pad, [0, -.065, 0]), add(pad, [0, .065, 0]), .09, .016);
    }
  }
  for (let i = 0; i <= rungCount; i++) {
    const c = outer(lerp(a, b, i / rungCount));
    member('rung', add(c, [-width / 2, 0, 0]), add(c, [width / 2, 0, 0]), .028, .028, true);
  }
  return { members, anchors, count: rungCount + 1, spacingM: rise / rungCount, angleDeg: Math.atan2(rise, run) * 180 / Math.PI };
}
/** Member basis: local Z along its span; local X is horizontal across the span.
 * Vertical spans use +X. Treads explicitly use +Y for their thickness axis. */
export function accessMemberAxes(m: AccessMember): [Point, Point, Point] {
  const d = sub(m.b, m.a), l = Math.hypot(...d), z = mul(d, 1 / l);
  const x: Point = m.name === 'tread' ? [0, 1, 0] : Math.hypot(z[0], z[2]) > 1e-8 ? mul([z[2], 0, -z[0]], 1 / Math.hypot(z[0], z[2])) : [1, 0, 0];
  const y: Point = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
  return [x, y, z];
}
