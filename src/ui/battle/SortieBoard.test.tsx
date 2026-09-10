import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SortieBoard } from './SortieBoard';
import { BATTLE_MODES } from './battleModes';

test('the sortie board answers the same four questions for every mode and marks the last one played', () => {
  const html = renderToStaticMarkup(<SortieBoard lastMode="pve" onChoose={() => {}} onClose={() => {}}/>);
  expect(html).toContain('Choose a battle'); expect(html).toContain('role="radiogroup"');
  for (const mode of BATTLE_MODES) { expect(html).toContain(mode.name); expect(html).toContain(mode.pitch); expect(html).toContain(mode.action); }
  expect(html.match(/<dt>You<\/dt>/g)).toHaveLength(3); expect(html.match(/<dt>Needs<\/dt>/g)).toHaveLength(3);
  expect(html).toContain('Last played'); expect(html.match(/Last played/g)).toHaveLength(1);
  expect(html).toContain('>Online<'); expect(html).toContain('200,000 t total');
  expect(html).toContain('Skip this next time'); expect(html).toContain('Back to port');
  // The last mode is the checked card; the others stay out of the tab order until chosen with the arrows.
  expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>(?:(?!<\/button>).)*Fleet command/s);
  expect(html.match(/aria-checked="false" tabindex="-1"/g)).toHaveLength(2);
});

test('every mode ledger covers You, Enemy, Fleet and Needs in that order', () => {
  for (const mode of BATTLE_MODES) expect(mode.ledger.map(fact => fact.label)).toEqual(['You', 'Enemy', 'Fleet', 'Needs']);
});
