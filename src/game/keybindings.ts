export const KEYBINDING_STORAGE_KEY = 'sea-trials-keybindings-v1';

export const INPUT_ACTIONS = [
  { id: 'throttleUp', label: 'Raise engine order', group: 'Helm' },
  { id: 'throttleDown', label: 'Lower engine order', group: 'Helm' },
  { id: 'port', label: 'Steer port', group: 'Helm' },
  { id: 'starboard', label: 'Steer starboard', group: 'Helm' },
  { id: 'stop', label: 'Stop engine', group: 'Helm' },
  { id: 'dive', label: 'Dive 10 m deeper', group: 'Helm' },
  { id: 'rise', label: 'Rise 10 m', group: 'Helm' },
  { id: 'emergencyBlow', label: 'Emergency blow ballast', group: 'Helm' },
  { id: 'fire', label: 'Fire selected battery', group: 'Gunnery' },
  { id: 'mainBattery', label: 'Select main battery', group: 'Gunnery' },
  { id: 'secondaryBattery', label: 'Select secondary battery', group: 'Gunnery' },
  { id: 'torpedoes', label: 'Select torpedoes', group: 'Gunnery' },
  { id: 'depthCharges', label: 'Select depth charges', group: 'Gunnery' },
  { id: 'gunnery', label: 'Open / close gunnery', group: 'Gunnery' },
  { id: 'shellFollow', label: 'Toggle shell follow camera', group: 'Gunnery' },
  { id: 'camera', label: 'Cycle camera', group: 'View' },
  { id: 'recenter', label: 'Recenter camera', group: 'View' },
  { id: 'hud', label: 'Show / hide instruments', group: 'View' },
  { id: 'fullscreen', label: 'Toggle fullscreen', group: 'View' },
  { id: 'chartLarger', label: 'Increase minimap size', group: 'View' },
  { id: 'chartSmaller', label: 'Decrease minimap size', group: 'View' },
] as const;

export type InputAction = typeof INPUT_ACTIONS[number]['id'];
export type Keybindings = Record<InputAction, [string | null, string | null]>;

export function defaultKeybindings(): Keybindings {
  return {
    throttleUp: ['KeyW', 'ArrowUp'], throttleDown: ['KeyS', 'ArrowDown'],
    port: ['KeyA', 'ArrowLeft'], starboard: ['KeyD', 'ArrowRight'],
    stop: ['Space', null], fire: ['KeyQ', null], camera: ['KeyC', null],
    recenter: ['KeyR', null], hud: ['KeyH', null], fullscreen: ['KeyF', null],
    mainBattery: ['Digit1', null], secondaryBattery: ['Digit2', null], gunnery: ['KeyG', null],
    shellFollow: ['KeyT', null], torpedoes: ['Digit3', null],
    depthCharges: ['Digit4', null],
    dive: ['KeyZ', null], rise: ['KeyX', null], emergencyBlow: ['KeyB', null],
    chartLarger: ['Equal', 'NumpadAdd'], chartSmaller: ['Minus', 'NumpadSubtract'],
  };
}

export function isBindableKey(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Numpad(Add|Subtract|Multiply|Divide|Decimal))$/.test(code);
}

export function keyLabel(code: string | null): string {
  if (!code) return 'Unbound';
  const labels: Record<string, string> = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  return labels[code] ?? code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
}

export function bindingLabel(bindings: Keybindings, action: InputAction): string {
  return bindings[action].filter((code): code is string => code !== null).map(keyLabel).join(' / ');
}

export function bindingError(bindings: Keybindings, action: InputAction, slot: 0 | 1, code: string | null): string | null {
  if (code === null) return bindings[action][slot === 0 ? 1 : 0] ? null : 'Keep at least one key for this action.';
  if (!isBindableKey(code)) return 'Choose a letter, number, arrow, Space, or punctuation key.';
  for (const entry of INPUT_ACTIONS) {
    if (bindings[entry.id].some((key, index) => key === code && (entry.id !== action || index !== slot))) {
      return `${keyLabel(code)} is already assigned to ${entry.label.toLowerCase()}. Change that binding first.`;
    }
  }
  return null;
}

export function keybindingsOf(value: unknown): Keybindings {
  const defaults = defaultKeybindings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const result = defaultKeybindings();
  const used = new Set<string>();
  const missing: InputAction[] = [];
  for (const { id } of INPUT_ACTIONS) {
    const pair = (value as Record<string, unknown>)[id];
    if (pair === undefined) { missing.push(id); continue; }
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.some(Boolean)) return defaults;
    for (const code of pair) {
      if (code === null) continue;
      if (typeof code !== 'string' || !isBindableKey(code) || used.has(code)) return defaults;
      used.add(code);
    }
    result[id] = [pair[0], pair[1]];
  }
  // Add new actions to older saves without discarding existing custom controls.
  const additions = ['shellFollow', 'torpedoes', 'depthCharges', 'dive', 'rise', 'emergencyBlow'];
  for (const id of [...missing.filter(id => !additions.includes(id)), ...missing.filter(id => additions.includes(id))]) {
    const preferred = defaults[id].filter((code): code is string => code !== null && !used.has(code));
    if (!additions.includes(id) && preferred.length !== defaults[id].filter(Boolean).length) return defaults;
    const key = preferred[0] ?? Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => `Key${letter}`).find(code => !used.has(code));
    if (!key) return defaults;
    result[id] = [key, preferred[1] ?? null];
    result[id].forEach(code => { if (code) used.add(code); });
  }
  return result;
}

export function loadKeybindings(): Keybindings {
  try { return keybindingsOf(JSON.parse(localStorage.getItem(KEYBINDING_STORAGE_KEY) ?? 'null')); }
  catch { return defaultKeybindings(); }
}
