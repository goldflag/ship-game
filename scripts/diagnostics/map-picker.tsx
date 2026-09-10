import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleDialog } from '../../src/ui/battle/BattleDialog';
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
  // ?mode=custom|pve|duel opens that mode; ?step=deploy opens the deployment chart.
  const mode = ['custom', 'pve', 'duel'].includes(query.get('mode') ?? '') ? query.get('mode') as 'custom' | 'pve' | 'duel' : 'custom';
  const step = query.get('step') === 'deploy' ? 'deploy' : 'fleet';
  const bots = Math.max(0, Math.min(29, Number(query.get('bots')) || 0));
  const ids = Object.keys(shipPresets);
  const roster = (offset: number) => Array.from({ length: bots }, (_, i) => ids[(i + offset) % ids.length]);
  function Review() {
    const [setup, setSetup] = useState<BattleSetup>({ playerShipId: 'bismarck', friendlyBots: roster(1), enemies: bots ? roster(4) : ['bismarck'], spawnDistance: 5000, mapId: 'pacific-islands' });
    return <BattleDialog initialMode={mode} initialStep={step} initialShipId="bismarck" loading={false} onClose={() => {}} setup={setup} onSetupChange={setSetup} onLaunchCustom={() => {}} customError="" onLaunchPve={async () => {}} onOnlineBattle={async () => {}}/>;
  }
  createRoot(document.querySelector('#root')!).render(<Review/>);
}
