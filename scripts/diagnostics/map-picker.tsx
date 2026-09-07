import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleSetupDialog } from '../../src/ui/BattleSetupDialog';
import type { BattleSetup } from '../../src/simulation/battle';
import '../../src/ui/styles.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';

const query = new URLSearchParams(location.search);
if (query.has('mobile') && !query.has('frame')) {
  const frame = document.createElement('iframe');
  frame.src = '?frame=1'; frame.title = 'Mobile battle setup';
  document.querySelector('#root')!.replaceWith(frame);
} else {
  function Review() {
    const [setup, setSetup] = useState<BattleSetup>({ playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 5000, mapId: 'pacific-islands', sea: 'Atlantic' });
    return <BattleSetupDialog setup={setup} onChange={setSetup} onLaunch={() => {}} onClose={() => {}} error=""/>;
  }
  createRoot(document.querySelector('#root')!).render(<Review/>);
}
