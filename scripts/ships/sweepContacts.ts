/** Pure parts of `bun run ship:sweep`: mount filters, seat contacts, contact grouping and accepted contacts.
 * sweep.ts runs Blender and the interlock replay around these; sweepContacts.test.ts covers them. */

/** A sampled pose in degrees and recoil fraction: [train, elevation, recoil]. */
export type SweepPose = [number, number, number];
export type SweepClash = { moving: string; joint?: 'train' | 'elevation'; fixed: string; fixedAssembly?: string | null; poses: SweepPose[] };
export type SweepMount = { id: string; samples: number; seats?: string[]; clashes: SweepClash[] };
/** articulation_sweep.py's output (.build/ships/<id>/sweep.json). */
export type Sweep = { mounts: SweepMount[]; neighbours: { a: string; b: string; poses: number[][] }[] };

/** Split `--mounts` on commas outside braces: `main-*,{aa,ha}-?` is two patterns. */
export function splitPatterns(list: string): string[] {
  const out: string[] = [];
  let depth = 0, current = '';
  for (const c of list) {
    if (c === '{') depth++;
    if (c === '}') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) { out.push(current); current = ''; } else current += c;
  }
  out.push(current);
  return out.map(s => s.trim()).filter(Boolean);
}

/** A shell glob over a whole mount ID: `*` any run, `?` one character, `[ab]`/`[a-c]`/`[!a]` a class,
 * `{a,b}` alternatives. Anything else is literal. */
export function globRegExp(pattern: string): RegExp {
  let source = '', depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') source += '.*';
    else if (c === '?') source += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end < 0) { source += '\\['; continue; }
      let body = pattern.slice(i + 1, end);
      const negate = body[0] === '!' || body[0] === '^';
      if (negate) body = body.slice(1);
      source += `[${negate ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`;
      i = end;
    } else if (c === '{') { source += '(?:'; depth++; }
    else if (c === '}' && depth) { source += ')'; depth--; }
    else if (c === ',' && depth) source += '|';
    else source += c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  }
  return new RegExp(`^${source}${')'.repeat(depth)}$`);
}

export const globMatch = (pattern: string, value: string) => globRegExp(pattern).test(value);

/** The IDs `patterns` select, in `ids` order, and the patterns that selected nothing. */
export function selectMounts(ids: string[], patterns: string[]): { selected: string[]; unmatched: string[] } {
  const regexps = patterns.map(globRegExp);
  return {
    selected: ids.filter(id => regexps.some(r => r.test(id))),
    unmatched: patterns.filter((_, i) => !ids.some(id => regexps[i].test(id))),
  };
}

/** A rotating-base part (it trains but does not elevate) touching a fixed mesh the mount stands on: the mount
 * sitting on its own seat or support, not a clash the gun's aim decides. */
export const isSeatContact = (mount: SweepMount, clash: SweepClash) => clash.joint === 'train' && !!mount.seats?.includes(clash.fixed);

/** Fixed-structure contacts of one mount grouped by the part touched, in first-contact order, with duplicate
 * poses merged; seat contacts are grouped apart. */
export type ContactGroup = { against: string; fixed: string; assembly?: string; poses: SweepPose[] };
export function groupContacts(mount: SweepMount): { clashes: ContactGroup[]; seats: ContactGroup[] } {
  const clashes = new Map<string, ContactGroup>(), seats = new Map<string, ContactGroup>();
  for (const clash of mount.clashes) {
    const assembly = clash.fixedAssembly ?? undefined;
    const against = assembly && assembly !== clash.fixed ? `${clash.fixed} (${assembly})` : clash.fixed;
    const groups = isSeatContact(mount, clash) ? seats : clashes;
    const group = groups.get(against) ?? { against, fixed: clash.fixed, assembly, poses: [] };
    for (const p of clash.poses) if (!group.poses.some(q => q[0] === p[0] && q[1] === p[1] && q[2] === p[2])) group.poses.push(p);
    groups.set(against, group);
  }
  return { clashes: [...clashes.values()], seats: [...seats.values()] };
}

/** One entry of assets/ships/<id>/sweep-accepted.json. `mount` and `against` are globs; `against` names the
 * touched part's assembly ID or mesh name, or the other mount of a neighbouring pair. */
export type AcceptedContact = { mount: string; against: string; reason: string };
export const ACCEPTED_FILE = 'sweep-accepted.json';

/** Parse and check an accepted-contacts file; throws naming the bad entry. */
export function parseAccepted(text: string, where = ACCEPTED_FILE): AcceptedContact[] {
  const data = JSON.parse(text) as { accepted?: unknown };
  if (!data || !Array.isArray(data.accepted)) throw new Error(`${where}: expected { "accepted": [{ "mount", "against", "reason" }, …] }`);
  return data.accepted.map((entry, i) => {
    const e = entry as Partial<AcceptedContact>;
    for (const key of ['mount', 'against', 'reason'] as const) {
      if (typeof e?.[key] !== 'string' || !e[key]!.trim()) throw new Error(`${where}: accepted[${i}] needs a non-empty string "${key}"`);
    }
    return { mount: e.mount!, against: e.against!, reason: e.reason! };
  });
}

/** What an accepted entry can match: a mount and the names of what it touched. */
export type ContactKey = { mount: string; against: string[]; kind: 'fixed' | 'mount' };
export function acceptedMatches(entry: AcceptedContact, key: ContactKey): boolean {
  const one = (mount: string, against: string[]) => globMatch(entry.mount, mount) && against.some(a => globMatch(entry.against, a));
  // A neighbouring pair is unordered.
  return one(key.mount, key.against) || (key.kind === 'mount' && key.against.length === 1 && one(key.against[0], [key.mount]));
}

/** For each failing contact, the first entry that accepts it (or undefined); and the entries that accept nothing
 * among the mounts swept this run (stale). */
export function applyAccepted(entries: AcceptedContact[], failing: ContactKey[], swept: string[]) {
  const used = new Set<AcceptedContact>();
  const accepted = failing.map(key => {
    const entry = entries.find(e => acceptedMatches(e, key));
    if (entry) used.add(entry);
    return entry;
  });
  const stale = entries.filter(e => !used.has(e) && swept.some(id => globMatch(e.mount, id)));
  return { accepted, stale };
}
