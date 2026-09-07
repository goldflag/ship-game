import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button, Input, Select, SelectOption } from '../../src/ui/components';

/** Run in a Vite-served browser: exercises real focus, popovers and modal dismissal. */
export async function checkSharedControls() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let selected = 'a', cancels = 0;
  function Fixture() {
    const [value, setValue] = useState('a');
    return <dialog open onCancel={event => { event.preventDefault(); cancels++; }}>
      <label>Ship
      <Select id="test-select" value={value} onValueChange={next => { selected = next; setValue(next); }}>
        <SelectOption value="a">Baltimore</SelectOption>
        <SelectOption value="lost" disabled>Lost ship</SelectOption>
        <SelectOption value="b">Bismarck</SelectOption>
        <SelectOption value="c">Yamato</SelectOption>
      </Select></label>
      <Input aria-label="Search"/><Button>Next control</Button>
    </dialog>;
  }
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const settle = () => new Promise(resolve => requestAnimationFrame(resolve));
  try {
    flushSync(() => root.render(<Fixture/>));
    const dialog = host.querySelector('dialog')!;
    dialog.close(); dialog.showModal();
    const trigger = host.querySelector<HTMLButtonElement>('[role=combobox]')!;
    const menu = host.querySelector<HTMLElement>('[role=listbox]')!;
    const key = async (key: string) => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
      await settle();
    };
    check(!host.querySelector('select, option'), 'No native dropdown elements');
    trigger.focus(); trigger.click(); await settle();
    check(menu.matches(':popover-open'), 'Dropdown opens above a modal');
    check(document.activeElement === trigger, 'Focus stays on combobox');
    await key('ArrowDown'); await key('Enter');
    check(selected === 'b', 'Arrow navigation skips disabled options and commits');
    check(!menu.matches(':popover-open'), 'Selection closes menu');
    trigger.click(); await settle(); await key('End'); await key('Escape');
    check(selected === 'b' && cancels === 0, 'Escape cancels without changing value or closing dialog');
    await key('y'); await key('Enter'); check(selected === 'c', 'Typeahead selects by label');
    trigger.click(); await settle(); await key('Home'); await key('Enter'); check(selected === 'a', 'Home reaches first option');
    trigger.click(); await settle();
    host.querySelector<HTMLElement>('[role=option][aria-disabled=true]')!.click(); await settle();
    check(selected === 'a' && menu.matches(':popover-open'), 'Disabled options cannot commit');
    host.querySelector<HTMLElement>('[role=option]:last-child')!.click(); await settle();
    check(selected === 'c', 'Click selects an option');
    trigger.click(); await settle();
    await key('Tab'); check(!menu.matches(':popover-open'), 'Tab dismisses the menu');
    trigger.click(); await settle();
    host.querySelector('input')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await settle();
    check(!menu.matches(':popover-open'), 'Outside click dismisses the menu');
    trigger.click(); await settle();
    flushSync(() => {
      const input = host.querySelector('input')!;
      input.focus();
      // Background embedded browsers update activeElement without dispatching focus events.
      if (!document.hasFocus()) input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    }); await settle();
    check(!menu.matches(':popover-open'), 'Moving focus dismisses the menu');
    return { passed: 13 };
  } finally { root.unmount(); host.remove(); }
}
