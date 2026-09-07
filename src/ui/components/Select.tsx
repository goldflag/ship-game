import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Icon } from '../Icons';

interface OptionProps { value: string | number; children: ReactNode; disabled?: boolean }
/** Declarative data for Select; never renders a native option element. */
export function SelectOption(_props: OptionProps) { return null; }
type SelectProps = Omit<ComponentProps<'button'>, 'value' | 'onChange' | 'children' | 'onClick' | 'onKeyDown' | 'onBlur' | 'ref'> & {
  value: string | number;
  onValueChange(value: string): void;
  children: ReactNode;
};
const labelText = (node: ReactNode): string => Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? labelText(child.props.children) : String(child)).join('');

/** Select-only combobox. Focus stays on its trigger; the list opens in the top layer. */
export function Select({ value, onValueChange, children, className = '', id, disabled, ...props }: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-options`;
  const options = Children.toArray(children).filter(isValidElement<OptionProps>).map(child => child.props);
  const selected = options.findIndex(option => String(option.value) === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const available = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const activeIndex = available.includes(active) ? active : available[0] ?? -1;
  const close = () => setOpen(false);
  const show = (last = false) => {
    trigger.current?.focus({ preventScroll: true });
    setActive(available.includes(selected) ? selected : (last ? available.at(-1) : available[0]) ?? -1);
    setOpen(true);
  };
  const choose = (index: number) => {
    if (options[index] && !options[index].disabled) onValueChange(String(options[index].value));
    close();
    trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open || !list.current || !trigger.current) return;
    const node = list.current;
    node.showPopover();
    const position = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const margin = 8, gap = 4;
      const below = window.innerHeight - rect.bottom - margin - gap;
      const above = rect.top - margin - gap;
      const downward = below >= Math.min(280, node.scrollHeight) || below >= above;
      const height = Math.max(0, Math.min(280, downward ? below : above));
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - margin * 2);
      Object.assign(node.style, {
        width: `${width}px`, maxHeight: `${height}px`,
        left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
        top: `${downward ? rect.bottom + gap : Math.max(margin, rect.top - gap - Math.min(node.scrollHeight, height))}px`,
      });
    };
    position();
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const focusOutside = (event: FocusEvent) => {
      if (event.target !== trigger.current && !node.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => { if (!node.contains(event.target as Node)) position(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focusOutside, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', scroll, true);
    return () => {
      node.hidePopover();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', focusOutside, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => { if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }); }, [open, activeIndex, listId]);

  return <>
    <button {...props} id={triggerId} ref={trigger} type="button" disabled={disabled || !available.length}
      className={`ui-select ${className}`} role="combobox" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={listId} aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      onClick={() => open ? close() : show()} onBlur={close}
      onKeyDown={event => {
        if (event.key === 'Tab') { close(); return; }
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (!open) {
            show(event.key === 'ArrowUp');
            if (event.key === 'Home' || event.key === 'End') setActive((event.key === 'Home' ? available[0] : available.at(-1)) ?? -1);
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') { choose(activeIndex); return; }
          const step = event.key === 'ArrowUp' ? -1 : 1;
          const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1)
            : available[(available.indexOf(activeIndex) + step + available.length) % available.length];
          setActive(next ?? -1);
        } else if (event.key.length === 1) {
          event.preventDefault(); event.stopPropagation();
          const now = Date.now();
          const text = now - search.current.time < 700 ? search.current.text + event.key : event.key;
          search.current = { text, time: now };
          const query = [...text].every(char => char === text[0]) ? text[0] : text;
          const start = open ? activeIndex : selected;
          const match = [...available.filter(i => i > start), ...available.filter(i => i <= start)]
            .find(i => labelText(options[i].children).trim().toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
          if (match !== undefined) { setActive(match); setOpen(true); }
        }
      }}>
      <span className="ui-select-value">{options[selected]?.children ?? 'Choose…'}</span><Icon name="chevron" size={14}/>
    </button>
    <div ref={list} id={listId} popover="manual" role="listbox" aria-labelledby={triggerId} className="ui-select-menu"
      onPointerDown={event => event.preventDefault()} onClick={event => event.preventDefault()}>
      {options.map((option, index) => <div key={String(option.value)} id={`${listId}-${index}`} role="option"
        aria-selected={selected === index} aria-disabled={option.disabled || undefined}
        data-active={index === activeIndex} className="ui-select-option"
        onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => { if (!option.disabled) choose(index); }}>
        <span>{option.children}</span>{selected === index && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>}
      </div>)}
    </div>
  </>;
}
