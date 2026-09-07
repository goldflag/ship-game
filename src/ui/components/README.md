# Shared naval controls

Import controls from `src/ui/components`. `controls.css` owns the shared maritime surface, brass accent, borders, focus marks, disabled states and touch targets. Surface CSS owns layout and density. Keep specialized helm instruments and map markers in their existing components.

```tsx
import { Button, Input, Select, SelectOption } from './components';

<Button variant="primary" onClick={launch}>Start battle</Button>
<Button variant="secondary" onClick={reset}>Reset</Button>
<Button variant="icon" aria-label="Close" onClick={close}><Icon name="close"/></Button>
<label>Find a ship<Input type="search" value={query} onChange={e => setQuery(e.target.value)}/></label>
<label htmlFor="ship">Ship</label>
<Select id="ship" value={shipId} onValueChange={setShipId}>
  {ships.map(ship => <SelectOption key={ship.id} value={ship.id} disabled={ship.lost}>{ship.name}</SelectOption>)}
</Select>
```

`Button` defaults to `type="button"` and the secondary variant. Icon buttons require an accessible label. `Input` preserves native text, range, radio and checkbox behavior and supports their normal props, including refs.

Use `Select` for every game dropdown. `SelectOption` declares choices; it never renders a native `<option>`. Values may be strings or numbers; `onValueChange` always receives a string, so convert numeric values at the call site. Associate a visible label using `htmlFor`/`id`, a wrapping label, or provide `aria-label`.

The select-only combobox retains focus on its trigger and announces the active option. Up/down opens and navigates enabled choices, Home/End reaches either end, typing searches labels, Enter/Space commits, Escape cancels, and Tab or an outside click dismisses. Disabled choices remain visible. The custom list uses the browser's Popover API top layer to avoid clipping in scrolling rosters, transformed HUDs and modal dialogs. Placement is clamped to the viewport and follows scrolling/resizing. No external component package is required.

Run the real-browser regression with Vite serving this checkout, on a blank same-origin page:

```js
import('/scripts/tests/controls-browser.tsx').then(module => module.checkSharedControls())
```

It checks selection, disabled options, typeahead, cancellation, focus and dismissal inside a modal. Gameplay shortcuts are covered by `src/game/InputController.test.ts`; survivor filtering and cycling by `src/game/Game.test.ts`.
