import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyProfile, openProfile, type ProgressProfile } from '../progression/rules';
import type { ProgressSnapshot } from '../progression/store';
import { nodePlace, TECH_TREE, techNation, type NationId } from '../progression/techTree';
import { describeResearch, research, TechTree } from './TechTree';

const noop = () => {};
const snapshot = (profile: ProgressProfile, status: ProgressSnapshot['status'] = 'ready', error?: string): ProgressSnapshot => ({
  status,
  profile,
  source: 'account',
  ...(error ? { error } : {}),
});
const withXp = (usa: number, free: number, unlocked: string[] = []): ProgressProfile => ({ ...emptyProfile(), xp: { ...emptyProfile().xp, usa }, freeXp: free, unlocked });
const render = (progress: ProgressSnapshot, nation: NationId = 'usa', initialNode?: string, berthedId?: string) =>
  renderToStaticMarkup(
    <TechTree
      snapshot={progress}
      berthedId={berthedId}
      berthedName="CLEVELAND"
      initialNation={nation}
      initialNode={initialNode}
      ready
      onClose={noop}
      onView={noop}
      onUnlock={async () => {}}
    />,
  );
/** A node's state and the words on it, keyed by the name it shows. */
function nodes(html: string) {
  const found = new Map<string, { state: string; text: string }>();
  for (const [, state, body] of html.matchAll(/class="tech-node" data-state="(\w+)"[^>]*>(.*?)<\/(?:button|div)><\/li>/g)) {
    const name = body.match(/<strong>(.*?)<\/strong>/)![1];
    found.set(name, { state, text: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  return found;
}

describe('the tech tree', () => {
  test('one column per line, oldest first, with owned starters, costs, shortfalls and placeholders', () => {
    const html = render(snapshot(emptyProfile()));
    const columns = [...html.matchAll(/<section class="tech-line" aria-label="(\w+)"/g)].map((match) => match[1]);
    expect(columns).toEqual(['Destroyers', 'Cruisers', 'Battleships', 'Carriers']);
    const us = nodes(html);
    expect([...us.keys()].slice(0, 6)).toEqual(['CLEMSON', 'FARRAGUT', 'GLEAVES', 'FLETCHER', 'ALLEN M. SUMNER', 'GEARING']);
    expect(us.get('GLEAVES')).toEqual({ state: 'owned', text: 'GLEAVES 1940 Destroyer Starter' });
    expect(us.get('FLETCHER')).toEqual({ state: 'short', text: 'FLETCHER 1942 Destroyer 1,800 XP 1,800 XP short' });
    expect(us.get('CLEMSON')).toEqual({ state: 'placeholder', text: 'CLEMSON 1919 Destroyer 800 XP Not in the game yet' });
    expect(us.get('ENTERPRISE')!.text).toContain('Aircraft carrier · Yorktown class');
    // Modelled nodes show their preset's thumbnail and can be chosen; placeholders are plain outlines.
    expect(html).toContain('models/fletcher-thumbnail.png');
    expect(html).not.toContain('models/us-clemson');
    expect(html.match(/<button class="tech-node"/g)).toHaveLength(techNation('usa').lines.flatMap(line => line.nodes).filter(node => node.presetId).length);
    // Connectors: mint along owned ships, brass from an owned ship to the next, dashed through placeholders.
    expect(html).toContain('class="tech-link" data-state="next"');
    expect(html).toContain('class="tech-link" data-state="unbuilt"');
  });

  test('nation tabs carry flags and XP; Germany has submarines and the UK escorts', () => {
    const progress = snapshot({ ...withXp(1240, 310), xp: { usa: 1240, japan: 0, germany: 800, uk: 0 } });
    const html = render(progress, 'germany');
    expect(html).toContain('aria-selected="true"');
    expect(html).toMatch(/id="tech-tab-germany" aria-selected="true".*?Germany<\/span><b>800<small>XP<\/small>/);
    expect(html).toMatch(/United States<\/span><b>1,240/);
    expect(html).toMatch(/Free XP<\/span><b>310<\/b>/);
    expect([...html.matchAll(/<section class="tech-line" aria-label="(\w+)"/g)].map((match) => match[1])).toEqual([
      'Destroyers',
      'Cruisers',
      'Battleships',
      'Carriers',
      'Submarines',
    ]);
    expect(render(progress, 'uk')).toContain('aria-label="Escorts"');
  });

  test('a ship within reach says where the XP comes from and offers the unlock', () => {
    const html = render(snapshot(withXp(1000, 1000)), 'usa', 'fletcher');
    expect(nodes(html).get('FLETCHER')!.state).toBe('available');
    expect(html).toContain('Paid from 1,000 United States XP and 800 free XP.');
    expect(html).toMatch(/<button class="port-command tech-unlock">.*?UNLOCK · 1,800 XP/);
    expect(html).toContain('View in port');
  });

  test('a ship out of reach keeps the unlock disabled and says how far off it is', () => {
    const html = render(snapshot(withXp(4200, 0)), 'usa', 'iowa');
    expect(nodes(html).get('IOWA')!.text).toBe('IOWA 1943 Battleship 6,500 XP 2,300 XP short');
    expect(html).toContain('Needs 2,300 more XP: you have 4,200 United States XP and 0 free XP.');
    expect(html).toMatch(/<button class="port-command tech-unlock" disabled="">/);
  });

  test('an owned ship alongside is marked and leads with the way back to the quay', () => {
    const html = render(snapshot(withXp(0, 0)), 'usa', 'cleveland', 'cleveland');
    expect(html).toContain('Alongside');
    expect(html).toContain('In your fleet from the start.');
    expect(html).toContain('BACK TO THE QUAY');
    expect(html).not.toContain('tech-unlock');
  });

  test('a prerequisite not yet owned is named', () => {
    const view = describeResearch(snapshot(emptyProfile()), nodePlace('fletcher')!, 'blocked');
    expect(view.status).toBe('After GLEAVES');
    expect(view.detail).toBe('Unlock GLEAVES first.');
  });

  test('without progress the tree says so quietly, keeps every ship open and unlocks nothing', () => {
    const html = render(snapshot(emptyProfile(), 'unavailable', 'Research progress is not available on this server yet.'), 'usa', 'iowa');
    expect(html).toContain('Research progress is not available on this server yet. Every ship stays open meanwhile');
    expect(nodes(html).get('IOWA')).toEqual({ state: 'open', text: 'IOWA 1943 Battleship 6,500 XP Open for now' });
    expect(html).toMatch(/<button class="port-command tech-unlock" disabled="">/);
    expect(research(snapshot(emptyProfile(), 'loading'), 'iowa')!.detail).toBe('Research progress is loading.');
  });

  test('the account-free harness owns every modelled ship', () => {
    const html = render(snapshot(openProfile()), 'japan');
    const states = [...nodes(html).values()].map((node) => node.state);
    const modelled = TECH_TREE.find((nation) => nation.id === 'japan')!.lines.flatMap((line) => line.nodes).filter((node) => node.presetId);
    expect(states.filter((state) => state === 'owned')).toHaveLength(modelled.length);
    expect(states.every((state) => state === 'owned' || state === 'placeholder')).toBe(true);
  });
});
