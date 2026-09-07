import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleSetupDialog } from '../../src/ui/BattleSetupDialog';
import type { BattleSetup } from '../../src/simulation/battle';
import { shipPresets } from '../../src/ships/presets';
import '../../src/ui/styles.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';

const query = new URLSearchParams(location.search);
if (query.has('mobile') && !query.has('frame')) {
  const frame = document.createElement('iframe');
  frame.src = '?frame=1'; frame.title = 'Mobile battle setup';
  document.querySelector('#root')!.replaceWith(frame);
} else {
  // ?bots=N fills both rosters with N bots each, cycling through the presets, to review large-team layouts.
  const bots = Math.max(0, Math.min(29, Number(query.get('bots')) || 0));
  const ids = Object.keys(shipPresets);
  const roster = (offset: number) => Array.from({ length: bots }, (_, i) => ids[(i + offset) % ids.length]);
  function Review() {
    const [setup, setSetup] = useState<BattleSetup>({ playerShipId: 'bismarck', friendlyBots: roster(1), enemies: bots ? roster(4) : ['bismarck'], spawnDistance: 5000, mapId: 'pacific-islands' });
    return <BattleSetupDialog setup={setup} onChange={setSetup} onLaunch={() => {}} onClose={() => {}} error=""/>;
  }
  createRoot(document.querySelector('#root')!).render(<Review/>);
}
