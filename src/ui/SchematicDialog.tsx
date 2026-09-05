// Extends Fleet harbor: maritime controls frame a model-derived drawing. The sheet leads;
// five compact choices precede the preview, with Save image and Copy image below it.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import {
  SCHEMATIC_OPTIONS, SCHEMATIC_PAGES, SCHEMATIC_STORAGE_KEY, schematicChoicesOf,
  schematicDrawingKey, schematicFileName, type SchematicChoices,
} from '../schematic/options';
import type { ShipSchematicRenderer } from '../schematic/render';
import './SchematicDialog.css';

type Sheet = { key: string; canvas: HTMLCanvasElement; blob: Blob; url: string };
const LABELS: Record<keyof SchematicChoices, string> = { layout: 'Layout', stock: 'Paper', units: 'Units', page: 'Resolution', format: 'Format' };

function loadChoices(): SchematicChoices {
  try { return schematicChoicesOf(JSON.parse(localStorage.getItem(SCHEMATIC_STORAGE_KEY) ?? 'null')); }
  catch { return schematicChoicesOf(null); }
}

export function SchematicDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [choices, setChoices] = useState(loadChoices);
  const [rig, setRig] = useState<ShipSchematicRenderer | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = schematicDrawingKey(choices);
  const visibleSheet = sheet?.key === key && !failure ? sheet : null;
  const currentSheet = useRef(visibleSheet);
  currentSheet.current = visibleSheet;

  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      currentSheet.current = null;
      node.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SCHEMATIC_STORAGE_KEY, JSON.stringify(choices)); } catch { /* Optional preferences. */ }
  }, [choices]);

  useEffect(() => {
    const controller = new AbortController();
    let resource: ShipSchematicRenderer | undefined;
    setRig(null); setFailure('');
    void import('../schematic/render').then(async ({ createShipSchematicRenderer }) => {
      controller.signal.throwIfAborted();
      resource = await createShipSchematicRenderer(controller.signal);
      if (controller.signal.aborted) resource.dispose();
      else setRig(resource);
    }).catch(error => {
      if (controller.signal.aborted) return;
      console.error('[schematic] Could not prepare ship', error);
      setFailure('The ship could not be prepared. Try creating the schematic again.');
    });
    return () => { controller.abort(); resource?.dispose(); };
  }, [attempt]);

  const { layout, stock, units, page } = choices;
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setSheet(null); setNotice('');
    if (!rig) return;
    // Briefly coalesce option changes. Cancelled requests never replace the visible sheet.
    const timer = window.setTimeout(() => {
      void rig.render({ layout, stock, units, page }, controller.signal).then(async canvas => {
        const { encodeSchematic } = await import('../schematic/render');
        controller.signal.throwIfAborted();
        const { blob } = await encodeSchematic(canvas, 'png');
        controller.signal.throwIfAborted();
        url = URL.createObjectURL(blob);
        setSheet({ key, canvas, blob, url });
      }).catch(error => {
        if (controller.signal.aborted) return;
        console.error('[schematic] Could not draw sheet', error);
        setFailure('The schematic could not be drawn. Try again.');
      });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [rig, key, layout, stock, units, page]);

  const save = async () => {
    if (!visibleSheet || exporting) return;
    const captured = visibleSheet;
    setExporting(true); setNotice('');
    try {
      // Encode the preview's canvas; saving never loads or renders a second ship.
      const { encodeSchematic } = await import('../schematic/render');
      const output = choices.format === 'png' ? { blob: captured.blob, format: 'png' as const }
        : await encodeSchematic(captured.canvas, choices.format);
      if (currentSheet.current !== captured) return;
      const url = URL.createObjectURL(output.blob);
      const link = document.createElement('a');
      link.href = url; link.download = schematicFileName({ ...choices, format: output.format });
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(output.format === choices.format ? 'Image saved.' : 'Saved as PNG; WebP is unavailable in this browser.');
    } catch {
      if (currentSheet.current === captured) setNotice('The image could not be saved. Try again.');
    } finally { setExporting(false); }
  };

  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
  const copy = async () => {
    if (!visibleSheet || !canCopy || exporting) return;
    const captured = visibleSheet;
    setExporting(true); setNotice('');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': captured.blob })]);
      if (currentSheet.current === captured) setNotice('Image copied.');
    } catch {
      if (currentSheet.current === captured) setNotice('Clipboard access was blocked. Use Save image instead.');
    } finally { setExporting(false); }
  };

  const dimensions = SCHEMATIC_PAGES[choices.page];
  return <dialog ref={dialog} className="schematic-dialog" aria-labelledby="schematic-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="schematic-header">
      <div><h2 id="schematic-title">Bismarck schematic</h2><p>Create a reference sheet of your ship.</p></div>
      <button type="button" className="icon-button" aria-label="Close schematic" onClick={onClose} autoFocus><Icon name="close" size={20}/></button>
    </header>
    <div className="schematic-options">
      {(Object.keys(SCHEMATIC_OPTIONS) as (keyof SchematicChoices)[]).map(field => <label key={field}>
        <span>{LABELS[field]}</span>
        <select value={choices[field]} disabled={exporting} onChange={event => {
          setChoices(value => schematicChoicesOf({ ...value, [field]: event.target.value }));
          setNotice('');
        }}>
          {Object.entries(SCHEMATIC_OPTIONS[field]).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>)}
    </div>
    <div className="schematic-preview" aria-busy={!visibleSheet && !failure}>
      {failure ? <div className="schematic-message" role="alert"><p>{failure}</p><button type="button" className="schematic-button" onClick={() => { setSheet(null); setAttempt(value => value + 1); }}>Try again</button></div>
        : visibleSheet ? <img src={visibleSheet.url} width={dimensions.width} height={dimensions.height} alt={`Bismarck ship schematic, ${SCHEMATIC_OPTIONS.layout[choices.layout].toLowerCase()} layout on ${SCHEMATIC_OPTIONS.stock[choices.stock].toLowerCase()} paper, with ${choices.units} model dimensions.`}/>
          : <div className="schematic-message" role="status"><Icon name="ship" size={36}/><p>{rig ? 'Drawing your schematic…' : 'Preparing the ship model…'}</p><span>The full hull, fittings and armament are included.</span></div>}
    </div>
    <footer className="schematic-footer">
      <div className="schematic-caption"><span>{dimensions.width} × {dimensions.height} · {SCHEMATIC_OPTIONS.format[choices.format]}</span>
        <p role="status">{notice || (canCopy ? 'Save or copy the picture shown above.' : 'Use Save image to keep your schematic.')}</p></div>
      <div className="schematic-actions">
        <button type="button" className="schematic-button" disabled={!visibleSheet || exporting || !canCopy} onClick={copy} title={canCopy ? 'Copy image as PNG' : 'Image clipboard is unavailable in this browser'}><Icon name="copy" size={17}/>Copy image</button>
        <button type="button" className="schematic-button schematic-save" disabled={!visibleSheet || exporting} onClick={save}><Icon name="download" size={17}/>{exporting ? 'Preparing image…' : 'Save image'}</button>
      </div>
    </footer>
  </dialog>;
}
