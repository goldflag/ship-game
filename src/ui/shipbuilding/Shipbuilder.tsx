import { isAccessKind } from '../../../assets/parts/construction/access_geometry';
import { resizedWallDimensions } from './wallDimensions';
import { WallSizeFields } from './WallSizeFields';
import { RailingFields } from './RailingFields';
import { RotationToolbar } from './RotationToolbar';
import { wallMount } from '../../ships/constructionWallFittings';
import { automaticPropellerLabel, propellerEngineName, propellerEngines } from './propellerAssignment';
import { SnapControls } from './SnapControls';
import { BalconyEditor } from './BalconyEditor';
import { CONSTRUCTION_PAINTS, constructionPaintColor, constructionShipPaint } from '../../ships/constructionPaints';
import { SurfaceFinishSelect } from './SurfaceFinishSelect';
import { integrateConstructionMagazines } from '../../ships/constructionArmament';
import { FreeformToolbar } from './FreeformToolbar';
import CustomHullEditor from './CustomHullEditor';
import { createPortal } from 'react-dom';
import { customHullPrimitive, editableCustomHull } from '../../ships/customHullModel';
import { NewDesignDialog } from './NewDesignDialog';
import { canEditVertices } from '../../ships/constructionVertex';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ConstructionCatalog,
  ConstructionEquipment,
  ConstructionPrimitive,
  ConstructionResult,
  ConstructionSource,
  ConstructionSuggestion,
  Vec3,
} from '../../ships/blueprint';
import { newConstructionId, surfaceSelectionKey } from '../../ships/constructionEditor';
import { CUSTOM_FITTING_SCALE, customFittingOf, isCustomFittingPartId } from '../../ships/constructionCustomFittings';
import { CustomFittingFields } from './CustomFittingFields';
import { carriedIds, mayFloat, parentCandidates } from '../../ships/constructionParents';
import { removeLocalShip } from '../../ships/localShips';
import { ConstructionClient } from '../../ships/constructionClient';
import { CONSTRUCTION_SHAPE_NAMES as SHAPE_NAMES } from '../../ships/constructionShapes';
import { createStarterSource, startingHullBlock, type ConstructionStarter } from '../../ships/constructionStarter';
import { constructionDiffCommands, type ConstructionCommand, type ConstructionBatch } from '../../ships/constructionCommands';
import { armorThicknessColor } from '../../ships/inspection';
import { BuilderViewport, type BuilderTag, type ConstructionModelFactory } from './BuilderViewport';
import { BUILDER_TABS, FAMILY_NAMES, formatTonnes, type BuilderLayer, type BuilderTab, type SlotItem } from './builderLayers';
import { BOUNDARY_NAMES } from './builderTool';
import { FITTING_CATEGORIES, NATION_SHORT, fittingCategory } from './fittingCategories';
import { HULL_CATEGORIES } from './hullCategories';
import { blockDimensions, dimensionText, resizeBlock } from './blockDimensions';
import {
  checksSummary,
  equipmentMassKg,
  format,
  hullBounds,
  ledgerRows,
  massGroups,
  pieceMassKg,
  splitDiagnostic,
  surfaceCentroid,
  warningEntries,
} from './builderReadings';
import { SlotGlyph, ToolGlyph } from './builderGlyphs';
import { DesignsMenu, downloadConstructionSource } from './DesignsMenu';
import { HelpDialog } from './HelpDialog';
import { ModelMemoryPanel } from './ModelMemoryPanel';
import type { VisualMemory } from './modelMemory';
import { ViewBar, type ViewBarTip } from './ViewBar';
import { pathSlackLimit, equipmentPathBounds } from '../../ships/constructionPaths';
import { PathPointEditor } from './PathPointEditor';
import { NumberField } from './NumberField';
import { SlotImages, useSlotImages } from './slotImages';
import { armorInspectionGroups, armorThicknessGroups, describeArmorGroup } from './ArmorInspection';
import { describeTurretArmor, installedTurretArmor } from './turretArmor';
import { attachmentOffset, rotateY, bearingRadians } from './placement';
import type { BuilderView } from './builderScene';
import { normalizedBearing } from './editorNumbers';
import { freshConstruction, useBuilderSource, type BuilderCompiler } from './useBuilderSource';
import type { ConstructionStore } from '../../ships/constructionStore';
import { openConstructionStore } from '../../ships/constructionStore';
import './Shipbuilder.css';

export interface ConstructionEditorHandle {
  source(): ConstructionSource;
  result(): ConstructionResult | undefined;
  apply(batch: ConstructionBatch): ConstructionSource;
  flush(): Promise<void>;
  launch(): Promise<void>;
  undo(): void;
  redo(): void;
}

export interface ShipbuilderProps {
  catalog: ConstructionCatalog;
  starterSource?: ConstructionSource;
  compileClient?: BuilderCompiler;
  initialSource?: ConstructionSource;
  initialDesignId?: string;
  repositoryId?: string;
  openStore?(): Promise<ConstructionStore>;
  onEditorReady?(editor: ConstructionEditorHandle | undefined): void;
  onClose(source: ConstructionSource, result?: ConstructionResult): void | Promise<void>;
  onLaunch(source: ConstructionSource, result: ConstructionResult): void | Promise<void>;
  onSave?(source: ConstructionSource): void;
  onDelete?(designId: string): void;
  createModel?: ConstructionModelFactory;
  suggestLayout?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
}

const VIEW_NAMES: Record<BuilderView, string> = { orbit: 'Orbit', top: 'Plan', side: 'Profile', bow: 'Bow' };
interface KeyHint {
  keys: string[];
  label: string;
}
const metres = (value: number) => Number(value.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
/** The card's corner label: whole metres stay bare, quarter and half plates read as fractions. */
const dimensions = (size: Vec3) =>
  size.map((value) => (value === 0.25 ? '¼' : value === 0.5 ? '½' : value === 0.75 ? '¾' : metres(value))).join('×');

/** The shipbuilder's markup. Layer, tool, selection and gestures live in `BuilderTool`; history,
 * autosave and the edit door in `ConstructionRevisionOwner`; the compile in `CompiledRevision`.
 * What remains here is chrome (drawer, menus, tips, dialogs) and the async flows over those modules. */
export function Shipbuilder(props: ShipbuilderProps) {
  const [compiler] = useState<BuilderCompiler>(() => props.compileClient ?? new ConstructionClient());
  const [starterSource] = useState(() => props.starterSource ?? createStarterSource(props.catalog, 'blank'));
  const suggestLayout =
    props.suggestLayout ??
    (compiler.suggest
      ? (source: ConstructionSource, ids: string[], signal?: AbortSignal) => compiler.suggest!(source, ids, signal)
      : undefined);
  const editor = useBuilderSource({ ...props, starterSource, compiler, suggest: suggestLayout });
  const {
      owner,
      revision,
      compiled,
      compile,
      tool,
      toolState: s,
      source,
      catalog,
      missingCatalogParts,
    } = editor,
    data = source.construction;
  const {
    layer,
    tool: activeTool,
    selected,
    surfaces,
    measure,
    pathPoints,
    customMm,
    mirror,
    showArcs,
    showCenters,
    freeformSettings,
    perspective,
    view,
    notice,
    suggestion,
    fittingFilter,
    hullCategory,
  } = s;
  const compiledResult = compile.current;
  const convertedDesigns = useRef(new Set<string>());
  useEffect(() => {
    if (!revision.ready || owner.locked || !catalog.equipment.length || data.version !== 1 || convertedDesigns.current.has(source.id))
      return;
    const next = structuredClone(source);
    integrateConstructionMagazines(next, catalog);
    const outcome = tool.run('Build ammunition into weapons', constructionDiffCommands(source, next));
    if (outcome.accepted) convertedDesigns.current.add(source.id);
  }, [revision.ready, owner.locked, source, catalog, tool]);

  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [rotationPreview, setRotationPreview] = useState<ConstructionPrimitive>();
  const [freeformPreview, setFreeformPreview] = useState<ConstructionPrimitive>();
  // The open drawer keeps the size of its full, unfiltered card set while a search narrows it, so the panel does not jump about under the pointer; the search clears when the drawer closes.
  const drawerRef = useRef<HTMLDivElement>(null);
  // The card row fades at whichever edge hides more cards.
  const hotbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = hotbarRef.current;
    if (!row) return;
    row.scrollLeft = 0;
    const update = () => {
      const end = row.scrollWidth - row.clientWidth - row.scrollLeft > 1,
        start = row.scrollLeft > 1;
      row.dataset.overflow = end && start ? 'both' : end ? 'end' : start ? 'start' : '';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    row.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      row.removeEventListener('scroll', update);
    };
  }, [layer, fittingFilter, hullCategory]);
  const [drawerSize, setDrawerSize] = useState<{ width: number; height: number }>();
  useLayoutEffect(() => {
    if (!drawer) {
      setDrawerSize(undefined);
      setQuery('');
      return;
    }
    const measure = () => {
      setDrawerSize(undefined);
      requestAnimationFrame(() => {
        const box = drawerRef.current;
        if (box) setDrawerSize({ width: box.offsetWidth, height: box.offsetHeight });
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [drawer, layer, hullCategory]);
  const [hoveredPart, setHoveredPart] = useState<string>();
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [designsOpen, setDesignsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [visualMemory, setVisualMemory] = useState<VisualMemory>();
  const [customHullSession, setCustomHullSession] = useState<{ designId: string; primitive: ConstructionPrimitive }>();
  // The section editor floats its draft hull on a compiler of its own, so measuring never cancels the builder's compile.
  const [hullMeasurer, setHullMeasurer] = useState<ConstructionClient>();
  useEffect(() => {
    if (!customHullSession || props.compileClient) return;
    const client = new ConstructionClient();
    setHullMeasurer(client);
    return () => {
      client.dispose();
      setHullMeasurer(undefined);
    };
  }, [customHullSession?.primitive.id, props.compileClient]);
  const [balconySession, setBalconySession] = useState<string>();
  const [newDesignOpen, setNewDesignOpen] = useState(false);
  const [tip, setTip] = useState<{
    title: string;
    detail: string;
    x: number;
    y: number;
    key?: string;
    slotId?: string;
    below?: boolean;
    right?: number;
    beside?: boolean;
  }>();
  const tooltipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!tip || !element) return;
    const contain = () => {
      element.style.translate = 'none';
      const rect = element.getBoundingClientRect();
      const host = element.closest('.shipbuilder')!.getBoundingClientRect();
      const left = Math.max(0, host.left) + 8,
        right = Math.min(window.innerWidth, host.right) - 8;
      const top = Math.max(0, host.top) + 8,
        bottom = Math.min(window.innerHeight, host.bottom) - 8;
      const x = Math.max(left, Math.min(rect.left, right - rect.width)) - rect.left;
      const y = Math.max(top, Math.min(rect.top, bottom - rect.height)) - rect.top;
      element.style.translate = `${x}px ${y}px`;
    };
    contain();
    window.addEventListener('resize', contain);
    return () => window.removeEventListener('resize', contain);
  }, [tip, s.sizeOverride]);
  const [slotImages] = useState(() => new SlotImages());
  useEffect(() => () => slotImages.dispose(), [slotImages]);

  const palette = tool.palette;
  const everyCard = palette.all ?? palette.drawer;
  const imageFor = useSlotImages(slotImages, everyCard, catalog);
  const active = tool.active;
  const drawerName = tool.drawerName,
    hasDrawer = tool.hasDrawer;
  const shelfNations = tool.shelfNations;
  const pathPart = tool.pathPart;
  const rail = tool.rail;
  const locked = owner.locked,
    busy = revision.busy;
  const selectedPrimitives = tool.selectedPrimitives,
    selectedEquipment = tool.selectedEquipment;
  const freeformPrimitive = tool.freeformPrimitive,
    freeformMode = !!freeformPrimitive;
  const selectedBoundary = tool.selectedBoundary;
  const partOf = tool.partOf;
  const editableSurfaces = tool.editableSurfaces,
    armorScale = tool.armorScale;
  const turretArmor = useMemo(() => (layer === 'armor' ? installedTurretArmor(source, catalog) : []), [layer, source, catalog]);
  const gridStep = tool.gridStep,
    piece = tool.piece;
  const fail = (cause: unknown) => owner.setError(cause instanceof Error ? cause.message : String(cause));
  const run = tool.run;
  const switchLayer = (next: BuilderLayer) => {
    tool.switchLayer(next);
    setDrawer(false);
    setQuery('');
    setTip(undefined);
  };
  const openTab = (next: BuilderTab) => {
    tool.openTab(next);
    setDrawer(false);
    setQuery('');
    setTip(undefined);
  };
  const tab = tool.tab;
  /** A warning's fitting opens the tab and shelf that hold it; an internal one opens Internals. */
  const showFitting = (id: string) => {
    const item = data.equipment.find((part) => part.id === id),
      part = item && partOf(item);
    if (!item || layer === 'internals') return;
    if (part?.placement === 'internal') {
      switchLayer('internals');
      return;
    }
    if (layer !== 'fittings') switchLayer('fittings');
    if (part) tool.setFittingFilter({ category: fittingCategory(part, catalog) });
  };
  const selectSlot = (item: SlotItem) => {
    if (tool.toggleSlot(item)) {
      setDrawer(false);
      setTip(undefined);
    }
  };
  const enterFreeform = () => {
    if (tool.enterFreeform()) setDrawer(false);
  };
  const suggestionChanged = tool.suggestionChanged;

  const newDesign = async (kind: ConstructionStarter, paint?: string) => {
    setDesignsOpen(false);
    await owner.replace(freshConstruction(createStarterSource(props.catalog, kind, paint), kind === 'blank'), null, false);
    switchLayer('hull');
    tool.setTool('select');
    tool.clearSelection();
    tool.fit();
    setNewDesignOpen(false);
  };
  const deleteDesign = async (designId: string, revisionId: string) => {
    const current = designId === source.id;
    owner.setBusy('Deleting');
    try {
      await owner.removeDesign(designId, revisionId, createStarterSource(props.catalog, 'blank'));
      props.onDelete?.(designId);
      removeLocalShip(designId);
      if (current) {
        switchLayer('hull');
        tool.fit();
        setDesignsOpen(false);
      }
      tool.notify('Design deleted.');
    } finally {
      owner.setBusy('');
    }
  };
  const saveCopy = async () => {
    setDesignsOpen(false);
    const copy = structuredClone(source);
    copy.id = newConstructionId('design');
    copy.revision = newConstructionId('revision');
    copy.name = `${copy.name.slice(0, 150)} copy`;
    try {
      await owner.replace(copy, null, false, true);
      tool.notify('A new design now holds this draft.');
    } catch (cause) {
      fail(cause);
    }
  };
  const saveLocalCopy = async () => {
    let storage: ConstructionStore | undefined;
    try {
      storage = await openConstructionStore();
      const copy = freshConstruction(source);
      await storage.save({
        designId: copy.id,
        name: copy.name,
        source: copy,
        schemaVersion: 1,
        catalogRevision: copy.construction.catalogRevision,
        expectedRevisionId: null,
      });
      tool.notify('A saved copy is available under My designs in the port carousel.');
      setDesignsOpen(false);
    } catch (cause) {
      fail(cause);
    } finally {
      storage?.close();
    }
  };
  const close = async () => {
    owner.setBusy('Saving');
    try {
      await owner.flush();
      await props.onClose(structuredClone(source), compiledResult);
    } catch (cause) {
      fail(cause);
    } finally {
      owner.setBusy('');
    }
  };
  const launch = async () => {
    const source = structuredClone(owner.source),
      compiled = editor.compiled.read();
    if (!compiled?.definition || compiled.diagnostics.some((item) => item.severity === 'error')) return;
    owner.setBusy('Launching');
    try {
      try {
        await owner.flush();
      } catch {
        /* App receives the immutable source even if local storage is unavailable. */
      }
      await props.onLaunch(structuredClone(source), structuredClone(compiled));
    } catch (cause) {
      fail(cause);
    } finally {
      owner.setBusy('');
    }
  };
  useEffect(() => {
    if (!revision.ready) return;
    props.onEditorReady?.({
      source: () => structuredClone(owner.source),
      result: compiled.read,
      apply: owner.applyBatch,
      flush: owner.flush,
      launch,
      undo: owner.undo,
      redo: owner.redo,
    });
    return () => props.onEditorReady?.(undefined);
  }, [source, compiledResult, revision.ready, revision.saveState]);

  // The latest render's closure handles keys, so a key right after a click sees the click's selection.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
    if (customHullSession || newDesignOpen) return;
    if (event.key === 'F8' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) {
        setHelpOpen(false);
        setMemoryOpen((value) => !value);
      }
      return;
    }
    if (event.key === 'Escape' && memoryOpen && !helpOpen) {
      event.preventDefault();
      setMemoryOpen(false);
      return;
    }
    if ((event.target as HTMLElement).closest('input,textarea,select,[role=combobox],[contenteditable=true]')) return;
    if (helpOpen) {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        setHelpOpen(false);
      }
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      setHelpOpen(true);
      return;
    }
    if (locked) return;
    if (event.key === 'Alt') {
      event.preventDefault();
      tool.setSnapOverride(true);
      return;
    }
    tool.key(event, {
      dismiss: () => {
        if (drawer) setDrawer(false);
        else if (designsOpen) setDesignsOpen(false);
        else if (warningsOpen) setWarningsOpen(false);
        else return false;
        return true;
      },
      toggleDrawer: () => {
        setDrawer((value) => !value);
        setTip(undefined);
      },
      toggleWarnings: () => setWarningsOpen((value) => !value),
      slotChosen: () => {
        setDrawer(false);
        setTip(undefined);
      },
    });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => keyHandler.current(event);
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Alt') tool.setSnapOverride(false);
    };
    const reset = () => tool.setSnapOverride(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // ---- derived display
  const warnings = warningEntries(compiledResult?.diagnostics);
  const blocks = warnings.filter((entry) => entry.tone === 'block'),
    warns = warnings.filter((entry) => entry.tone === 'warn');
  const checks = checksSummary(warnings),
    checksTone = compile.error || revision.error ? 'block' : checks.tone;
  const readingsSource = compile.retainedSource ?? source;
  const rows = useMemo(() => ledgerRows(readingsSource, compile.retained, layer), [readingsSource, compile.retained, layer]);
  const masses = useMemo(() => massGroups(compile.retained), [compile.retained]);
  const totalMass = masses.reduce((sum, group) => sum + group.massKg, 0);
  const canLaunch = !pathPoints.length && !!compiledResult?.definition && !blocks.length && !busy && revision.ready;
  const launchTitle = busy
    ? busy
    : compile.waiting
      ? 'Checks run when you pause editing. Sea trials need the latest checks.'
      : compile.compiling
        ? 'Checking this revision…'
        : blocks.length
          ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} to fix before a trial`
          : compiledResult?.definition
            ? 'Launch a sea trial with this design'
            : 'Waiting for a compiled design';
  const saveTone = revision.saveState.status === 'saved' ? 'ok' : revision.saveState.status === 'error' ? 'bad' : 'saving';
  const saveText =
    revision.saveState.status === 'saved'
      ? props.repositoryId
        ? 'Saved to repository'
        : 'Saved to account'
      : revision.saveState.status === 'error'
        ? 'Not saved · keep a backup'
        : 'Saving…';
  const filteredCards = layer === 'hull' ? palette.drawer : everyCard;
  const drawerItems = query
    ? filteredCards.filter((item) =>
        `${item.name} ${item.note} ${item.kind === 'part' ? `${item.part.name} ${FAMILY_NAMES[item.part.kind]} ${item.part.placement}` : ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
    : filteredCards;

  const tags: BuilderTag[] = [];
  // Mirror editing: the selection's edits also reach these twins, which the viewport outlines in mint.
  const twinCount = locked ? 0 : tool.selectionTwins.size;
  const twinNote = twinCount > 0 && (
    <span className="sb-twin-note">
      {' '}
      · {twinCount === 1 ? 'twin follows' : `${twinCount} twins follow`} <kbd>M</kbd>
    </span>
  );
  const equipmentAnchor = (item: ConstructionEquipment): Vec3 => {
    const part = partOf(item),
      center = part ? rotateY(equipmentPathBounds(part, item).center, bearingRadians(item.bearingDeg)) : [0, 0, 0];
    return item.position.map((value, index) => value + center[index]) as Vec3;
  };
  // The cursor piece reads out above the palette instead of following the ghost; its size fields stay editable there.
  // The Armor layer keeps its millimetre field here, above the bar: a new value also assigns the selected faces.
  const status: ReactNode = locked ? null : pathPart ? (
    <>
      <b>{pathPart.name}</b>
      {pathPart.path?.kind === 'ladder' || isAccessKind(pathPart.path?.kind) ? (
        <>
          <span>
            {pathPoints.length
              ? 'Click the upper endpoint to place · Esc cancels'
              : pathPart.path?.kind === 'inclined-ladder'
                ? 'Click the lower deck, then the upper deck edge'
                : 'Click the lower endpoint on a hull side'}
          </span>
          <button onClick={() => tool.cancelPath(false)}>
            Cancel <kbd>Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <span>{pathPoints.length ? `${pathPoints.length} points · click to extend` : 'Click the first point on the ship'}</span>
          {pathPart.path?.kind === 'railing' && <RailingFields heightM={s.railingHeight} onHeight={tool.setRailingHeight} />}
          {pathPart.path?.kind === 'rope' && (
            <NumberField
              label="Rope slack"
              value={Math.min(s.ropeSlack, pathSlackLimit(pathPoints))}
              min={0}
              max={pathSlackLimit(pathPoints)}
              step={0.05}
              unit="m"
              onChange={tool.setRopeSlack}
            />
          )}
          <button disabled={pathPoints.length < 2} onClick={tool.finishPath}>
            Finish <kbd>Enter</kbd>
          </button>
          <button onClick={() => tool.cancelPath(false)}>
            Cancel <kbd>Esc</kbd>
          </button>
          <span className="sb-path-hint">
            {pathPart.path?.kind === 'railing' ? 'Deck supports every post' : 'Hull or fitting support sockets'} · double-click finishes
          </span>
        </>
      )}
    </>
  ) : layer === 'armor' ? (
    <>
      <b>Armor</b>
      <NumberField label="Armor thickness" value={customMm} min={0} max={1000} step={1} unit="mm" onChange={tool.setThickness} />
      <span>
        {customMm > 0 ? 'armor steel' : 'structural skin, no armor'} · minimum {source.construction.defaultThicknessMm} mm skin
      </span>
      <NumberField
        label="Skin"
        description="Minimum plating thickness across the ship; lowering it also changes unassigned hull faces"
        value={source.construction.defaultThicknessMm}
        min={0.1}
        max={1000}
        step={0.1}
        unit="mm"
        onChange={(thicknessMm) => run('Change structural skin', [{ op: 'skin', thicknessMm }])}
      />
    </>
  ) : !piece ? null : piece.kind === 'hull' && active?.kind === 'shape' ? (
    <>
      <b>{active.name}</b>
      <NumberField
        value={piece.size[0]}
        min={0.25}
        max={500}
        step={1}
        onChange={(value) => tool.setSizeOverride([value, piece.size[1], piece.size[2]])}
      />{' '}
      ×{' '}
      <NumberField
        value={piece.size[1]}
        min={0.25}
        max={500}
        step={1}
        onChange={(value) => tool.setSizeOverride([piece.size[0], value, piece.size[2]])}
      />{' '}
      ×{' '}
      <NumberField
        value={piece.size[2]}
        min={0.25}
        max={500}
        step={1}
        onChange={(value) => tool.setSizeOverride([piece.size[0], piece.size[1], value])}
      />{' '}
      m
      <span>
        {piece.tilt ? `pitch ${piece.tilt.pitchDeg}° · yaw ${piece.rotationDeg}° · roll ${piece.tilt.rollDeg}°` : `${piece.rotationDeg}°`}
      </span>
    </>
  ) : piece.kind === 'equipment' && active?.kind === 'part' ? (
    <>
      <b>{active.part.name}</b>
      {piece.wall ? (
        <>
          <WallSizeFields part={active.part} wall={piece.wall} onChange={tool.setWallSize} />
          {['window', 'porthole'].includes(wallMount(active.part) ?? '') && (
            <>
              <button aria-pressed={!s.windowRow} onClick={() => tool.setWindowRow(false)}>
                Single
              </button>
              <button aria-pressed={s.windowRow} onClick={() => tool.setWindowRow(true)}>
                Row
              </button>
              {s.windowRow && (
                <NumberField
                  label="Spacing"
                  description="Distance between window centers. Click the first window, then click where the row ends."
                  value={piece.rowSpacing ?? s.windowSpacing}
                  min={piece.wall.widthM + 0.05}
                  max={20}
                  step={0.1}
                  unit="m"
                  onChange={tool.setWindowSpacing}
                />
              )}
            </>
          )}
          <span>
            {s.windowRow && ['window', 'porthole'].includes(wallMount(active.part) ?? '')
              ? 'Click the first window, then the last · Esc cancels'
              : 'Click a hull side or wall'}{' '}
            · {wallMount(active.part) === 'porthole' || active.part.wallSizing === 'uniform' ? '←→ / ↑↓ scale' : '←→ width · ↑↓ height'} ·
            Shift fine · R turn{mirror ? ' · linked mirror' : ''}
          </span>
        </>
      ) : (
        <span>
          {active.part.placement} · bearing {Number(piece.bearingDeg.toFixed(2))}°
        </span>
      )}
    </>
  ) : piece.kind === 'boundary' ? (
    <>
      <b>{BOUNDARY_NAMES[piece.axis]}</b>
      <span>on the {gridStep} m grid</span>
    </>
  ) : null;
  if (!freeformMode && s.tool !== 'rotate' && selectedPrimitives.length === 1 && !selectedEquipment.length) {
    const primitive = selectedPrimitives[0],
      mass = pieceMassKg(compiledResult, primitive.id);
    const measured = blockDimensions(primitive);
    const size = (axis: number, value: number) => tool.editPrimitive('Resize hull piece', resizeBlock(primitive, axis, value));
    tags.push({
      key: `piece-${primitive.id}`,
      anchor: primitive.position,
      dx: 70,
      dy: -78,
      tone: 'mint',
      content: (
        <>
          <b>
            {primitive.mesh?.label ?? SHAPE_NAMES[primitive.kind]}{' '}
            <NumberField
              description="Width along the block's local X axis"
              value={measured[0]}
              min={0.25}
              max={500}
              onChange={(value) => size(0, value)}
            />{' '}
            ×{' '}
            <NumberField
              label={primitive.kind === 'balcony' ? 'Deck thickness' : undefined}
              description={primitive.kind === 'balcony' ? 'Deck thickness' : "Height along the block's local Y axis"}
              value={measured[1]}
              min={primitive.kind === 'balcony' ? 0.01 : 0.25}
              max={500}
              step={primitive.kind === 'balcony' ? 0.01 : 1}
              onChange={(value) => size(1, value)}
            />{' '}
            ×{' '}
            <NumberField
              description="Length along the block's local Z axis"
              value={measured[2]}
              min={0.25}
              max={500}
              onChange={(value) => size(2, value)}
            />{' '}
            m
          </b>
          {canEditVertices(primitive) && (
            <button className="sb-edit-freeform" onClick={enterFreeform} aria-label="Freeform hull" title="Edit freeform shape (D)">
              Freeform <kbd>D</kbd>
            </button>
          )}
          {primitive.kind === 'custom-hull' && (
            <button
              className="sb-edit-freeform"
              onClick={() => setCustomHullSession({ designId: source.id, primitive: structuredClone(primitive) })}
            >
              Edit hull sections
            </button>
          )}
          {primitive.kind === 'balcony' && (
            <button
              className="sb-edit-freeform"
              onClick={() => {
                if (layer !== 'hull') tool.switchLayer('hull');
                setBalconySession(primitive.id);
              }}
            >
              Edit balcony outline
            </button>
          )}
          {mass !== undefined ? `plating ${formatTonnes(mass)} · ` : ''}
          {carriedIds(data, [primitive.id]).size > 0 && `carries ${carriedIds(data, [primitive.id]).size} · `}
          {primitive.rotationDeg}° <kbd>R</kbd> · <kbd>X</kbd>
          <kbd>Z</kbd> tip · <kbd>⌫</kbd> remove · <kbd>⌘C</kbd> copy{twinNote}
        </>
      ),
    });
  } else if (selectedEquipment.length === 1 && !selectedPrimitives.length) {
    const item = selectedEquipment[0],
      part = partOf(item),
      mass = equipmentMassKg(compiledResult, item.id);
    const catalogPart = catalog.equipment.find((p) => p.id === item.partId);
    const edit = (label: string, change: (target: ConstructionEquipment) => void, mirrored = false) => {
      const target = structuredClone(item);
      change(target);
      (mirrored ? tool.edit : run)(label, [{ op: 'equipment', value: target }]);
    };
    // Parents: a fitting that may float can ride a hull piece, a fitting or a gun; the parent carries it, and a gun trains it.
    const attachable = !!part && !item.wall && mayFloat(source, catalog, item, part);
    const riders = carriedIds(data, [item.id]).size;
    const parentOptions = attachable || item.parent ? parentCandidates(source, catalog, item) : [];
    const attachment = (attachable || item.parent) && (
      <label className="sb-engine-link">
        Attached to{' '}
        <select
          className="sb-link"
          aria-label="Attached to"
          disabled={locked}
          title="Moving, turning, copying or removing the parent carries this fitting. Its own position and bearing stay as they are. On a gun it also trains with the gun in battle."
          value={item.parent ?? ''}
          onChange={(event) =>
            edit(event.target.value ? 'Attach fitting' : 'Detach fitting', (target) => {
              if (event.target.value) target.parent = event.target.value;
              else delete target.parent;
            })
          }
        >
          <option value="">Nothing · stands alone</option>
          {item.parent && !parentOptions.some((option) => option.id === item.parent) && (
            <option value={item.parent}>{item.parent}</option>
          )}
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} · {option.distanceM.toFixed(1)} m
            </option>
          ))}
        </select>
      </label>
    );
    const engines = data.equipment.filter((entry) => partOf(entry)?.kind === 'engine');
    const assignedEngines = propellerEngines(source, compiledResult, item);
    const engineConnection = (
      <label className="sb-engine-link">
        Engine{' '}
        <select
          className="sb-link"
          aria-label="Propeller engine"
          disabled={locked}
          title="Automatic connections update with the layout and stay fixed during battle. Choose an engine to override."
          value={item.powerSourceId ?? ''}
          onChange={(event) =>
            edit('Assign propeller engine', (target) => {
              if (event.target.value) target.powerSourceId = event.target.value;
              else delete target.powerSourceId;
            })
          }
        >
          <option value="">{automaticPropellerLabel(source, compiledResult, item)}</option>
          {item.powerSourceId && !engines.some((e) => e.id === item.powerSourceId) && (
            <option value={item.powerSourceId}>Missing engine · {item.powerSourceId}</option>
          )}
          {engines.map((engine) => (
            <option key={engine.id} value={engine.id}>
              Manual · {propellerEngineName(engine)}
            </option>
          ))}
        </select>
        {!item.powerSourceId && assignedEngines.length > 1 && (
          <span className="sb-engine-sources">{assignedEngines.map(propellerEngineName).join('; ')}</span>
        )}
      </label>
    );
    tags.push({
      key: `part-${item.id}`,
      anchor: equipmentAnchor(item),
      dx: 82,
      dy: -92,
      tone: 'mint',
      content: (
        <>
          <b>
            {part?.path?.kind === 'railing'
              ? `${item.path?.railCount ?? part.path?.railCount ?? 3}-rail railing`
              : (part?.name ?? item.partId)}
          </b>
          {mass !== undefined ? `${formatTonnes(mass)} · ` : ''}
          {riders > 0 && `carries ${riders} · `}
          {item.wall ? (
            `Hull aligned${item.wall.turnDeg ? ` · turned ${item.wall.turnDeg}°` : ''} · `
          ) : (
            <>
              bearing{' '}
              <NumberField
                value={item.bearingDeg}
                min={0}
                max={360}
                step={0.1}
                unit="°"
                onChange={(value) =>
                  riders
                    ? // A parent turns what it carries about its datum.
                      tool.edit('Set bearing', [{ op: 'rotate', ids: [item.id], degrees: normalizedBearing(value) - item.bearingDeg }])
                    : edit(
                        'Set bearing',
                        (target) => {
                          target.bearingDeg = normalizedBearing(value);
                        },
                        true,
                      )
                }
              />
            </>
          )}
          {customFittingOf(data, item) && (
            <>
              {' '}
              · <CustomFittingFields definition={customFittingOf(data, item)!} data={data} locked={locked} run={run} />
              {' '}
              ·{' '}
              {(['X', 'Y', 'Z'] as const).map((axis, k) => (
                <NumberField
                  key={axis}
                  label={`Scale ${axis}`}
                  description={`Scale this instance along its own ${axis} axis about its datum; mass follows the volume`}
                  disabled={locked}
                  value={item.scale?.[k] ?? 1}
                  min={CUSTOM_FITTING_SCALE.min}
                  max={CUSTOM_FITTING_SCALE.max}
                  step={0.05}
                  unit="×"
                  onChange={(value) =>
                    edit(
                      'Scale custom fitting',
                      (target) => {
                        const scale = [...(target.scale ?? [1, 1, 1])] as [number, number, number];
                        scale[k] = value;
                        if (scale.every((n) => n === 1)) delete target.scale;
                        else target.scale = scale;
                      },
                      true,
                    )
                  }
                />
              ))}
            </>
          )}
          {item.wall && catalogPart && (
            <>
              <WallSizeFields
                part={catalogPart}
                wall={item.wall}
                onChange={(axis, value) =>
                  edit('Resize wall fitting', (target) => {
                    Object.assign(target.wall!, resizedWallDimensions(catalogPart, target.wall!, axis, value));
                  })
                }
              />
              {item.wall.mirrorId && <span> · Linked mirror · edits update both sides</span>}
            </>
          )}
          {part?.path && item.path && (
            <PathPointEditor
              key={item.id}
              item={item}
              part={part}
              onChange={(path) =>
                edit(
                  'Edit fitting path',
                  (target) => {
                    target.path = path;
                  },
                  true,
                )
              }
            />
          )}
          {part?.path?.kind === 'rope' && (
            <label>
              Rope color{' '}
              <select
                className="sb-link"
                aria-label="Rope color"
                disabled={locked}
                value={item.paint ?? ''}
                onChange={(event) => tool.paintFittings([item.id], event.target.value || undefined)}
              >
                <option value="">Original rope</option>
                {CONSTRUCTION_PAINTS.map((paint) => (
                  <option key={paint.id} value={paint.id}>
                    {paint.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {part?.kind === 'gun' && (
            <>
              {' '}
              ·{' '}
              <NumberField
                label="Turret rise"
                description="Raise the mount above its deck attachment. Below-deck magazines stay fixed; ready ammunition follows deck mounts."
                value={item.gun?.barbetteHeightM ?? 0}
                min={0}
                max={30}
                step={0.25}
                unit="m"
                onChange={(value) => tool.raiseTurrets([item.id], () => value)}
              />
            </>
          )}
          {data.version === 2 && (part?.kind === 'gun' || part?.kind === 'torpedo-launcher') && <span> · built-in ammunition</span>}
          {part?.kind === 'funnel' && <span> · {(part.exhaustKw ?? 0).toLocaleString()} kW shared exhaust</span>}
          {part?.kind === 'propeller' && engineConnection}
          {attachment}
          {item.wall ? (
            <>
              {' '}
              · <kbd>R</kbd> turn · <kbd>⇧R</kbd> back
            </>
          ) : (
            <>
              {' '}
              · <kbd>R</kbd> rotate · right-drag rotate · <kbd>⇧</kbd> fine
            </>
          )}{' '}
          · <kbd>⌫</kbd> remove{twinNote}
        </>
      ),
    });
  } else if (selected.size > 1) {
    const anchors = [...selectedPrimitives.map((part) => part.position), ...selectedEquipment.map(equipmentAnchor)];
    const center = anchors.reduce((sum, point) => sum.map((value, index) => value + point[index] / anchors.length) as Vec3, [
      0, 0, 0,
    ] as Vec3);
    const mass = [
      ...selectedPrimitives.map((part) => pieceMassKg(compiledResult, part.id) ?? 0),
      ...selectedEquipment.map((part) => equipmentMassKg(compiledResult, part.id) ?? 0),
    ].reduce((sum, value) => sum + value, 0);
    tags.push({
      key: 'group',
      anchor: center,
      dx: 70,
      dy: -78,
      tone: 'mint',
      content: (
        <>
          <b>{selected.size} selected</b>
          {mass ? `${formatTonnes(mass)} · ` : ''}
          <kbd>R</kbd> rotate · <kbd>⌘C</kbd> copy · <kbd>⇧⌘C</kbd> mirror copy · <kbd>⌫</kbd> remove{twinNote}
        </>
      ),
    });
  } else if (selectedBoundary) {
    const wall = selectedBoundary,
      axis = { x: 0, y: 1, z: 2 }[wall.axis],
      bounds = hullBounds(source);
    const anchor = (bounds ? bounds.min.map((value, index) => (value + bounds.max[index]) / 2) : [0, 0, 0]) as Vec3;
    anchor[axis] = wall.offset;
    tags.push({
      key: `wall-${wall.id}`,
      anchor,
      dx: 70,
      dy: -70,
      tone: 'mint',
      content: (
        <>
          <b>{BOUNDARY_NAMES[wall.axis]}</b>
          plating{' '}
          <NumberField
            value={wall.thicknessMm}
            min={0.1}
            max={1000}
            unit="mm"
            onChange={(value) => run('Armor boundary', [{ op: 'boundary', value: { ...wall, thicknessMm: value } }])}
          />{' '}
          · <kbd>⌫</kbd> remove and merge rooms
        </>
      ),
    });
  }
  // Only Paint builds face selections; Armor is a bucket and never selects faces.
  if (surfaces.size && layer === 'paint') {
    const chosen = editableSurfaces.filter((surface) => surfaces.has(surfaceSelectionKey(surface)));
    const first = chosen[0],
      groups = armorInspectionGroups(chosen),
      area = chosen.reduce((sum, surface) => sum + surface.areaM2, 0);
    if (first)
      tags.push({
        key: 'faces',
        anchor: surfaceCentroid(first),
        dx: 80,
        dy: -96,
        tone: 'mint',
        content: (
          <>
            <b>
              {surfaces.size} face{surfaces.size === 1 ? '' : 's'} ·{' '}
              {groups.length === 1 ? groups[0].surface.paint.replace('-', ' ') : `${groups.length} different paints`}
            </b>
            {format(area, 0)} m² · <kbd>1</kbd>–<kbd>9</kbd> paint · <kbd>⇧</kbd>click adds · <kbd>Esc</kbd> clear
          </>
        ),
      });
  }
  const hoveredBlock = blocks.find((entry) => entry.sourceId && entry.sourceId === hoveredPart);
  if (hoveredBlock) {
    const target =
      data.primitives.find((part) => part.id === hoveredBlock.sourceId) ?? data.equipment.find((part) => part.id === hoveredBlock.sourceId);
    const boundary = data.boundaries.find((wall) => wall.id === hoveredBlock.sourceId);
    let anchor = target ? ('partId' in target ? equipmentAnchor(target) : target.position) : undefined;
    if (boundary) {
      const bounds = hullBounds(source);
      anchor = (bounds ? bounds.min.map((value, index) => (value + bounds.max[index]) / 2) : [0, 0, 0]) as Vec3;
      anchor[{ x: 0, y: 1, z: 2 }[boundary.axis]] = boundary.offset;
    }
    if (anchor)
      tags.push({
        key: `block-${hoveredBlock.sourceId}`,
        anchor,
        dx: -262,
        dy: -80,
        tone: 'bad',
        passive: true,
        content: (
          <>
            <b>Blocks launch</b>
            <span>{hoveredBlock.message}</span>
          </>
        ),
      });
  }

  // Cards carry the piece, and hull cards its metre dimensions in the corner; the name and reading appear as a tooltip.
  const describe = (item: SlotItem): { title: string; detail: string } => {
    switch (item.kind) {
      case 'shape': {
        const size = active?.id === item.id && s.sizeOverride ? s.sizeOverride : item.shape.size;
        return { title: item.name, detail: [dimensionText(size), 'width × height × length', item.note].filter(Boolean).join(' · ') };
      }
      case 'armor':
        return {
          title: 'Armor',
          detail: `${customMm > 0 ? `${customMm} mm armor steel` : 'structural skin without armor'} · set the thickness above the bar · drag to sweep faces`,
        };
      case 'thickness':
        return {
          title: item.name,
          detail: `${item.note} · assigns ${item.mm > 0 ? `${item.mm} mm armor steel` : 'structural skin without armor'}`,
        };
      case 'opening':
        return { title: 'Opening', detail: 'removes the skin so the face admits water' };
      case 'part':
        return {
          title: item.part.name,
          detail: item.part.path
            ? `${item.note} · draw connected points`
            : `${item.note} · ${item.part.placement} · ${item.part.size.map(metres).join(' × ')} m`,
        };
      case 'tool':
      case 'scheme':
        return { title: item.name, detail: item.note };
      case 'paint':
        return { title: item.name, detail: 'paint' };
      default:
        return { title: '', detail: '' };
    }
  };
  // Palette tips stand above the bar, clear of the readout over the cards (below the bar they would run off the screen); drawer tips stay above their card. Each names the card's key.
  const tipTop = (rect: DOMRect) => {
    const readout = document.querySelector('.sb-cursor');
    return readout ? Math.min(rect.top, readout.getBoundingClientRect().top) : rect.top;
  };
  const showTip = (item: SlotItem, target: HTMLElement) => {
    if (item.kind === 'empty') return;
    const rect = target.getBoundingClientRect(),
      inDrawer = !!target.closest('.sb-drawer'),
      index = palette.bar.findIndex((entry) => entry.id === item.id);
    setTip({
      ...describe(item),
      slotId: item.id,
      x: rect.left + rect.width / 2,
      y: inDrawer ? rect.top : tipTop(rect),
      key: index >= 0 ? String(index + 1) : undefined,
    });
  };
  const hideTip = () => setTip(undefined);
  const face = (item: SlotItem) => {
    const image = imageFor(item);
    const picture = image ? <img src={image} alt="" draggable={false} /> : null;
    if (item.kind === 'shape')
      return (
        <>
          {picture ?? <SlotGlyph item={item} customMm={customMm} />}
          <i className="sb-dims">{dimensions(active?.id === item.id && s.sizeOverride ? s.sizeOverride : item.shape.size)}</i>
          {item.shape.kind === 'ballast' && <small className="sb-slot-weight">100 t</small>}
        </>
      );
    if (item.kind === 'part' && isCustomFittingPartId(item.part.id))
      return (
        <>
          {picture ?? <SlotGlyph item={item} customMm={customMm} scale={armorScale} />}
          <small className="sb-slot-weight" title="Instances fitted in this design">
            ×{data.equipment.filter((fitted) => fitted.partId === item.part.id).length}
          </small>
        </>
      );
    if (picture) return picture;
    switch (item.kind) {
      case 'armor':
        return (
          <i className="sb-swatch" style={{ background: armorThicknessColor(customMm, armorScale) }}>
            <span>{customMm} mm</span>
          </i>
        );
      case 'thickness':
        return (
          <i className="sb-swatch" style={{ background: armorThicknessColor(item.mm, armorScale) }}>
            <span>{item.mm} mm</span>
          </i>
        );
      case 'paint':
        return <i className="sb-swatch" style={{ background: item.color }} />;
      case 'scheme':
        return (
          <i
            className="sb-swatch"
            style={{
              background:
                item.id === 'two-tone'
                  ? 'linear-gradient(#64716f 50%, #7c8c91 50%)'
                  : 'repeating-linear-gradient(90deg, #405d70 0 25%, #b5bfbc 25% 50%)',
            }}
          />
        );
      case 'empty':
        return null;
      default:
        return <SlotGlyph item={item} customMm={customMm} scale={armorScale} />;
    }
  };
  const slot = (item: SlotItem) => {
    const pressed = activeTool !== 'select' && item.kind !== 'empty' && active?.id === item.id;
    return (
      <button
        key={item.id}
        className={`sb-slot ${item.kind === 'empty' ? 'empty' : ''}`}
        aria-pressed={pressed}
        aria-label={item.kind === 'part' ? item.part.name : item.name || undefined}
        disabled={item.kind === 'empty' || locked}
        onPointerEnter={(event) => showTip(item, event.currentTarget)}
        onPointerLeave={hideTip}
        onFocus={(event) => showTip(item, event.currentTarget)}
        onBlur={hideTip}
        onClick={() => selectSlot(item)}
      >
        {face(item)}
      </button>
    );
  };

  // ---- hotkey legend above the compass: the standing keys on the bottom row; the keys acting on the cursor piece, the selection or the picked faces on a row above.
  // Keys already printed elsewhere (rail tools and modifiers, the view strip's Q P C A Home, W on the warnings lead, ⌘Z on undo, ? on Keys) stay off it.
  const faceLayer = layer === 'armor' || layer === 'paint';
  const movable = selectedPrimitives.length + selectedEquipment.length > 0;
  // While shaping, 1–4 choose the selection mode and the freeform toolbar prints them; the cards are away.
  const standing: KeyHint[] = freeformMode
    ? []
    : [
        {
          keys: palette.bar.length < 4 ? palette.bar.map((_, index) => String(index + 1)) : ['1', '…', '9'],
          label: surfaces.size && faceLayer ? (layer === 'paint' ? 'Paint faces' : 'Assign armor') : 'Card',
        },
        ...(hasDrawer ? [{ keys: ['0'], label: `All ${drawerName}` }] : []),
      ];
  const acting: KeyHint[] = [];
  if (!locked && piece && piece.kind !== 'boundary' && !(piece.kind === 'equipment' && piece.wall))
    acting.push(...(piece.kind === 'hull' ? [{ keys: ['X', 'Y', 'Z'], label: 'Turn 90°' }] : []), {
      keys: ['R'],
      label: piece.kind === 'hull' ? 'Rotate 90°' : 'Rotate 15°',
    });
  else if (s.tool === 'rotate') acting.push({ keys: ['X', 'Y', 'Z'], label: 'Turn 90°' }, { keys: ['R', '⇧R'], label: '±90°' });
  else if (movable && !freeformMode && !selectedEquipment.some((e) => e.wall))
    acting.push(...(selectedPrimitives.length && layer === 'hull' ? [{ keys: ['X', 'Y', 'Z'], label: 'Turn 90°' }] : []), {
      keys: ['R'],
      label: selectedPrimitives.length ? 'Rotate 90°' : 'Rotate 15°',
    });
  if (movable && !freeformMode)
    acting.push(
      { keys: ['←→', '↑↓'], label: selectedEquipment.every((e) => e.wall) && selectedEquipment.length ? 'Resize · Shift fine' : 'Nudge' },
      { keys: ['PgUp', 'PgDn'], label: 'Raise · lower' },
      { keys: ['⌘C'], label: 'Copy' },
      { keys: ['⇧⌘C'], label: 'Mirror copy' },
    );
  if (selected.size) acting.push({ keys: ['⌫', '⌘X'], label: movable ? 'Remove' : 'Remove · merge rooms' });
  if (!freeformMode && selected.size === 1 && selectedPrimitives[0] && canEditVertices(selectedPrimitives[0]))
    acting.push({ keys: ['D'], label: 'Freeform' });
  if (surfaces.size && faceLayer) acting.push({ keys: ['⇧'], label: 'Click adds a face' });
  const escape = pathPart
    ? 'Cancel path'
    : drawer || designsOpen || warningsOpen
      ? 'Close'
      : suggestion
        ? 'Dismiss layout'
        : measure
          ? 'End measure'
          : activeTool !== tool.restTool
            ? layer === 'armor'
              ? 'Paint tool'
              : 'Select tool'
            : selected.size || surfaces.size
              ? 'Clear'
              : '';
  if (escape) acting.push({ keys: ['Esc'], label: escape });
  const chip = (hint: KeyHint) => (
    <span key={hint.label} className="sb-key">
      {hint.keys.map((key, index) => (
        <kbd key={index}>{key}</kbd>
      ))}
      {hint.label}
    </span>
  );

  // Rail cells carry no caption: the name, state, description and key stand beside the hovered or focused cell, clear of the rail.
  const showRailTip = (entry: ViewBarTip | undefined) => {
    if (!entry) {
      setTip(undefined);
      return;
    }
    const rect = entry.target.getBoundingClientRect(),
      strip = (entry.target.closest('.sb-rail') ?? entry.target).getBoundingClientRect();
    setTip({ title: entry.title, detail: entry.detail, key: entry.key, x: strip.right + 10, y: rect.top + rect.height / 2, beside: true });
  };
  const railTip = (title: string, detail: string, key?: string) => {
    const show = (event: { currentTarget: HTMLElement }) => showRailTip({ title, detail, key, target: event.currentTarget });
    return { onPointerEnter: show, onPointerLeave: hideTip, onFocus: show, onBlur: hideTip };
  };
  const viewBar = (
    <ViewBar
      viewName={VIEW_NAMES[view]}
      perspective={perspective}
      showCenters={showCenters}
      showArcs={layer === 'fittings' ? showArcs : undefined}
      onView={tool.cycleView}
      onProjection={tool.toggleProjection}
      onCenters={tool.toggleCenters}
      onArcs={tool.toggleArcs}
      onFit={tool.fit}
      onTip={showRailTip}
    />
  );
  const balconyEditing =
    layer === 'hull' &&
    selectedPrimitives.length === 1 &&
    selectedPrimitives[0].kind === 'balcony' &&
    selectedPrimitives[0].id === balconySession;
  const tipItem = tip?.slotId ? everyCard.find((item) => item.id === tip.slotId) : undefined;
  const visibleTip = tipItem && tip ? { ...tip, ...describe(tipItem) } : tip;
  const hullFilters = (
    <div
      className="sb-chips sb-hull-filters"
      role="radiogroup"
      aria-label="Block type"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const index = HULL_CATEGORIES.findIndex((category) => category.id === hullCategory);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? HULL_CATEGORIES.length - 1
              : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + HULL_CATEGORIES.length) % HULL_CATEGORIES.length;
        tool.setHullCategory(HULL_CATEGORIES[next].id);
        setTip(undefined);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}
    >
      {HULL_CATEGORIES.map((category) => (
        <button
          key={category.id}
          role="radio"
          aria-checked={hullCategory === category.id}
          tabIndex={hullCategory === category.id ? 0 : -1}
          onClick={() => {
            tool.setHullCategory(category.id);
            setTip(undefined);
          }}
        >
          {category.name}
        </button>
      ))}
    </div>
  );
  // The outline editor belongs to one selection: deselecting or leaving the Hull layer closes it rather than parking it.
  useEffect(() => {
    if (balconySession && !balconyEditing) setBalconySession(undefined);
  }, [balconySession, balconyEditing]);
  return (
    <main
      className={`shipbuilder ${freeformMode ? 'sb-freeform-mode' : ''}`}
      aria-label="Shipbuilder"
      data-balcony-editing={balconyEditing || undefined}
      data-wall-placement={(piece?.kind === 'equipment' && !!piece.wall) || undefined}
      data-path-drawing={!!pathPart || undefined}
      data-layer={layer}
      data-drawer={drawer || undefined}
      aria-busy={!!busy}
    >
      {balconyEditing && (
        <BalconyEditor
          key={`${source.id}:${balconySession}`}
          primitive={selectedPrimitives[0]}
          onChange={(value) => tool.editPrimitive('Edit balcony', value)}
          onClose={() => setBalconySession(undefined)}
        />
      )}
      {newDesignOpen && <NewDesignDialog onClose={() => setNewDesignOpen(false)} onCreate={newDesign} />}
      {customHullSession?.designId === source.id &&
        createPortal(
          <CustomHullEditor
            integration={{
              hull: editableCustomHull(customHullSession.primitive),
              designName: source.name,
              appearance: source.construction,
              measure:
                hullMeasurer &&
                (async (hull, signal) => {
                  const draft = structuredClone(source),
                    target = draft.construction.primitives.find((part) => part.id === customHullSession.primitive.id);
                  if (!target) throw new Error('This hull is no longer part of the design.');
                  Object.assign(target, customHullPrimitive(hull, target));
                  draft.revision = newConstructionId('hull-draft');
                  const result = await hullMeasurer.compile(draft, signal),
                    loading = result.loading,
                    bounds = hullBounds(draft);
                  if (!loading || !bounds)
                    throw new Error(result.diagnostics.find((d) => d.severity === 'error')?.message ?? 'The draft hull did not float.');
                  return {
                    waterline: loading.waterlineY - target.position[1],
                    draft: loading.waterlineY - bounds.min[1],
                    displacementTonnes: loading.massKg / 1000,
                  };
                }),
              onClose: () => setCustomHullSession(undefined),
              onApply: (hull) => {
                const existing = data.primitives.find((part) => part.id === customHullSession.primitive.id);
                if (existing) {
                  const commands: ConstructionCommand[] = [{ op: 'primitive', value: customHullPrimitive(hull, existing) }];
                  tool.edit('Edit custom hull', commands);
                }
                setCustomHullSession(undefined);
                tool.fit();
              },
            }}
          />,
          document.body,
        )}
      {!revision.ready || (!compile.retained && compile.compiling) ? (
        <div className="sb-empty" role="status">
          Loading ship…
        </div>
      ) : (
        <BuilderViewport
          scene={tool.scene(compile.retained)}
          tags={tags}
          status={status}
          onPointer={tool.pointer}
          onHover={setHoveredPart}
          onFreeformPreview={setFreeformPreview}
          onRotationPreview={setRotationPreview}
          createModel={props.createModel}
          onMemory={memoryOpen ? setVisualMemory : undefined}
        />
      )}
      {layer === 'hull' && s.tool === 'rotate' && <RotationToolbar tool={tool} preview={rotationPreview} />}
      {freeformPrimitive && (
        <FreeformToolbar
          primitive={freeformPrimitive}
          preview={freeformPreview}
          onCommit={tool.commitFreeform}
          settings={freeformSettings}
          onChange={tool.changeFreeformSettings}
          onMode={tool.setFreeformMode}
          twin={!!tool.freeformTwin}
          mirror={mirror}
          onMirror={tool.toggleMirror}
          cycleUnit={tool.cycleUnit}
          onReset={tool.resetFreeform}
          onSplit={tool.splitFreeform}
          onExit={tool.exitFreeform}
        />
      )}
      <header className="sb-top">
        <button className="sb-port" disabled={!!busy || !!pathPoints.length} onClick={() => void close()} title="Save and return to port">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M8 1.5 3.5 6 8 10.5" />
          </svg>
          Port
        </button>
        <div className="sb-ship">
          <input
            disabled={locked}
            className="sb-name"
            aria-label="Design name"
            maxLength={160}
            value={source.name}
            onChange={(event) => run('Rename design', [{ op: 'name', name: event.target.value }])}
          />
          <button
            className="sb-meta"
            disabled={!!pathPoints.length}
            aria-haspopup="menu"
            aria-expanded={designsOpen}
            onClick={() => setDesignsOpen((value) => !value)}
          >
            {data.primitives.length} pieces · {data.equipment.length} fittings{' '}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="m2 3.5 3 3 3-3" />
            </svg>
          </button>
          <i className={`sb-save ${saveTone}`} role="status">
            {saveText}
          </i>
          {designsOpen && !props.repositoryId && (
            <DesignsMenu
              missingCatalogParts={missingCatalogParts}
              disabled={locked}
              store={editor.store}
              currentId={source.id}
              refresh={revision.saveState.revision?.id}
              onClose={() => setDesignsOpen(false)}
              onNew={(kind) => {
                if (kind) void newDesign(kind).catch(fail);
                else {
                  setDesignsOpen(false);
                  setNewDesignOpen(true);
                }
              }}
              onSaveCopy={() => void saveCopy()}
              onDelete={deleteDesign}
              onDownload={() => {
                downloadConstructionSource(JSON.stringify(source, null, 2), source.name);
                setDesignsOpen(false);
              }}
              onOpen={async (next, revision) => {
                setDesignsOpen(false);
                await owner.replace(next, revision, true);
                switchLayer('hull');
                tool.clearSelection();
              }}
              onRecover={async (next) => {
                setDesignsOpen(false);
                await owner.replace(next, null, false);
                switchLayer('hull');
                tool.clearSelection();
              }}
            />
          )}
          {designsOpen && props.repositoryId && (
            <div className="sb-menu" role="menu" aria-label="Repository source">
              <div className="sb-menu-row">
                <span className="sb-lead">Source</span>
                <span>{props.repositoryId}/blueprint.json</span>
              </div>
              <div className="sb-menu-row">
                <button role="menuitem" onClick={() => downloadConstructionSource(JSON.stringify(source, null, 2), source.name)}>
                  Download backup
                </button>
              </div>
              <div className="sb-menu-row">
                <button
                  role="menuitem"
                  disabled={locked}
                  onClick={() =>
                    void editor
                      .reloadRepository()
                      .then(() => setDesignsOpen(false))
                      .catch(fail)
                  }
                >
                  Reload repository
                </button>
                <button role="menuitem" disabled={locked} onClick={() => void saveLocalCopy()}>
                  Save local copy
                </button>
                <button role="menuitem" onClick={() => setDesignsOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
        {/* Checks hang from the top bar so a message never moves the rail: the chip counts blocks and warnings, W opens the list, and rows that need an answer (errors, layout proposals, notices) open the panel themselves. */}
        <div className="sb-warn">
          <button
            className={`lead ${checksTone}`}
            aria-expanded={warningsOpen}
            title="Design checks (W)"
            onClick={() => setWarningsOpen((value) => !value)}
          >
            <i className={`sb-dot ${checksTone}`} />
            {compile.compiling ? (
              compile.waiting ? (
                'Checks pending'
              ) : (
                'Checking design…'
              )
            ) : (
              <>
                {!compiledResult ? 'Draft · ' : ''}
                {checks.label}
              </>
            )}{' '}
            <kbd>W</kbd>
          </button>
          {(warningsOpen || compile.error || revision.error || suggestion || notice) && (
            <div className="sb-checks" role="group" aria-label="Checks">
              {warningsOpen && (
                <div className="sb-checks-head">
                  <span className="sb-lead">Checks</span>
                  <span>
                    {blocks.length} block{blocks.length === 1 ? '' : 's'} · {warns.length} warning{warns.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {compile.error && (
                <div className="row bad">
                  <i className="sb-dot block" />
                  <span>{compile.error}</span>
                  <button onClick={compiled.retry}>Retry</button>
                </div>
              )}
              {revision.error && (
                <div className="row bad" role="alert">
                  <i className="sb-dot block" />
                  <span>{revision.error}</span>
                  <button onClick={() => downloadConstructionSource(JSON.stringify(source, null, 2), source.name)}>Download</button>
                  <button onClick={() => void owner.retrySave()?.catch(fail)}>Retry save</button>
                  {props.repositoryId && <button onClick={() => void editor.reloadRepository().catch(fail)}>Reload repository</button>}
                  <button onClick={() => void (props.repositoryId ? saveLocalCopy() : saveCopy())}>
                    {props.repositoryId ? 'Save local copy' : 'Save a copy'}
                  </button>
                  <button onClick={() => owner.setError('')}>Dismiss</button>
                </div>
              )}
              {warningsOpen &&
                (warnings.length ? (
                  <div className="rows">
                    {warnings.map((entry, index) => {
                      const [finding, advice] = splitDiagnostic(entry.message);
                      return (
                        <button
                          key={`${entry.code}-${index}`}
                          className={`row ${entry.tone === 'note' ? 'note' : ''}`}
                          title={entry.sourceId ? 'Select the affected part' : entry.code}
                          onClick={() => {
                            if (entry.sourceId) {
                              tool.choose(entry.sourceId);
                              showFitting(entry.sourceId);
                            }
                          }}
                        >
                          <i className={`sb-dot ${entry.tone}`} />
                          <span>
                            {finding}
                            {advice && <small>{advice}</small>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="row note">
                    <i className="sb-dot ok" />
                    <span>{compiledResult ? 'Nothing blocks a sea trial.' : 'Checks appear after the design is checked.'}</span>
                  </div>
                ))}
              {suggestion && (
                <div className="row" role="status">
                  <i className={`sb-dot ${suggestion.proposal.diagnostics.some((item) => item.severity === 'error') ? 'block' : 'ok'}`} />
                  <span>
                    {suggestion.proposal.diagnostics.map((item) => item.message).join(' · ') ||
                      (suggestionChanged
                        ? 'A layout is ready; the dashed outlines show where it adds equipment.'
                        : 'The requested equipment is already fitted.')}
                  </span>
                  {suggestionChanged && !suggestion.proposal.diagnostics.some((item) => item.severity === 'error') && (
                    <button disabled={source.revision !== suggestion.revision} onClick={tool.applySuggestion}>
                      Apply <kbd>⏎</kbd>
                    </button>
                  )}
                  <button onClick={tool.dismissSuggestion}>Dismiss</button>
                </div>
              )}
              {notice && (
                <div className="row note" role="status">
                  <i className="sb-dot note" />
                  <span>{notice}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="sb-actions">
          <button
            className="sb-undo"
            disabled={locked || !!pathPoints.length || !revision.history.past.length}
            onClick={owner.undo}
            title={revision.history.past.length ? `Undo ${revision.history.lastAction}` : 'Nothing to undo'}
          >
            <kbd>⌘Z</kbd>
            {revision.history.past.length}
          </button>
          <button
            className="sb-undo"
            disabled={locked || !!pathPoints.length || !revision.history.future.length}
            onClick={owner.redo}
            title="Redo (⇧⌘Z)"
          >
            <kbd>⇧⌘Z</kbd>
            {revision.history.future.length}
          </button>
          <button className="sb-cmd" disabled={!canLaunch} title={launchTitle} onClick={() => void launch()}>
            {busy ? `${busy.toUpperCase()}…` : revision.saveState.status === 'error' ? 'TRIAL DRAFT' : 'SEA TRIALS'}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" />
            </svg>
          </button>
        </div>
      </header>
      <div className="sb-left">
        {/* One joined strip of glyph cells: tools, then the modifiers that change where a click lands, then how the ship is shown. Names and keys appear beside the hovered cell. */}
        <div className="sb-rail" role="toolbar" aria-label="Tools">
          {rail.map((entry) => (
            <button
              key={entry.id}
              className={entry.kind}
              disabled={locked}
              aria-pressed={entry.kind === 'tool' ? activeTool === entry.id : undefined}
              aria-label={`${entry.name} (${entry.key})`}
              onClick={() => tool.activateRail(entry)}
              {...railTip(entry.name, '', entry.key)}
            >
              <ToolGlyph name={entry.glyph} />
              <kbd>{entry.key}</kbd>
            </button>
          ))}
          {layer === 'hull' && (
            <button
              aria-pressed={freeformMode}
              aria-label="Freeform (D)"
              disabled={locked || selected.size !== 1 || !selectedPrimitives[0] || !canEditVertices(selectedPrimitives[0])}
              onClick={freeformMode ? tool.exitFreeform : enterFreeform}
              {...railTip('Freeform', 'Select one editable shape to edit vertices, edges, faces or rings', 'D')}
            >
              <ToolGlyph name="Freeform" />
              <kbd>D</kbd>
            </button>
          )}
          <i className="sb-rail-rule" aria-hidden="true" />
          {/* Modifiers change where a click lands rather than what it does; freeform mode carries its own local mirror axes and unit. */}
          {!freeformMode && (
            <button
              className="toggle"
              disabled={locked}
              aria-pressed={mirror}
              aria-label="Mirror (M)"
              onClick={tool.toggleMirror}
              {...railTip(
                `Mirror · ${mirror ? 'On' : 'Off'}`,
                'Place across the centerline; moving, turning, resizing, shaping, painting or removing a piece does the same to its twin, outlined in mint',
                'M',
              )}
            >
              <ToolGlyph name="Mirror" />
              <kbd>M</kbd>
            </button>
          )}
          <SnapControls tool={tool} locked={locked} onTip={showRailTip} />
          {!freeformMode && (
            <>
              <i className="sb-rail-rule" aria-hidden="true" />
              {viewBar}
            </>
          )}
          <i className="sb-rail-rule" aria-hidden="true" />
          {!freeformMode && (tool.selectedPrimitives.length > 0 || tool.selectedEquipment.length > 0) && (
            <button
              disabled={locked}
              aria-label="Center selection"
              onClick={tool.centerSelection}
              {...railTip('Center', 'Center the selection on the ship using its mounting centers')}
            >
              <ToolGlyph name="Centerline" />
            </button>
          )}
          <button
            className="help"
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
            aria-label="Controls and hotkeys (?)"
            onClick={() => setHelpOpen((value) => !value)}
            {...railTip('Keys', 'Every control and hotkey', '?')}
          >
            <ToolGlyph name="Keys" />
            <kbd>?</kbd>
          </button>
        </div>
      </div>
      <aside className="sb-ledger" aria-label="Ledger">
        <h4>
          Ledger
          {!compiledResult && (
            <span
              title={
                compile.retained
                  ? 'Readings from the last checked revision. They update after you pause editing.'
                  : 'Readings appear after the design is checked.'
              }
            >
              {compile.retained ? 'last check' : 'pending'}
            </span>
          )}
        </h4>
        {rows.map((row) => (
          <div key={row.label} className={`row ${row.tone ?? ''}`} title={row.help}>
            <span>{row.label}</span>
            <b>{row.value}</b>
          </div>
        ))}
        {totalMass > 0 && (
          <>
            <div className="sb-massbar" aria-hidden="true">
              {masses
                .filter((group) => group.massKg > 0)
                .map((group) => (
                  <i key={group.name} style={{ width: `${((100 * group.massKg) / totalMass).toFixed(1)}%`, background: group.color }} />
                ))}
            </div>
            <div className="sb-masskey">
              {masses
                .filter((group) => group.massKg > 0)
                .map((group) => (
                  <span key={group.name} style={{ display: 'contents' }}>
                    <i style={{ background: group.color }} />
                    <span>{group.name}</span>
                    <b>{formatTonnes(group.massKg, group.massKg < 1e5 ? 1 : 0)}</b>
                  </span>
                ))}
            </div>
          </>
        )}
        {/* Every thickness on the ship, thickest first on the ship's own colour scale; a row picks that value's card. */}
        {layer === 'armor' && (
          <div className="sb-armor-groups" aria-label="Armor thicknesses in use">
            {armorThicknessGroups(editableSurfaces).map((group) => {
              const card = group.open
                ? undefined
                : palette.drawer.find((item) => item.kind === 'thickness' && item.mm === group.thicknessMm);
              const text = (
                <>
                  {describeArmorGroup(group)}
                  <small>
                    {format(group.areaM2, 0)} m² · {group.faces.size} face{group.faces.size === 1 ? '' : 's'}
                  </small>
                </>
              );
              return card ? (
                <button
                  key={group.id}
                  disabled={locked}
                  aria-pressed={active?.kind === 'thickness' && active.mm === group.thicknessMm}
                  title={`Pick ${group.thicknessMm} mm for the Armor card`}
                  onClick={() => selectSlot(card)}
                >
                  <i style={{ background: armorThicknessColor(group.thicknessMm, armorScale) }} />
                  <span>{text}</span>
                </button>
              ) : (
                <p key={group.id}>
                  <i />
                  <span>{text}</span>
                </p>
              );
            })}
          </div>
        )}
        {/* Guns bring their own protection from the catalog: shown on the same scale, never editable. */}
        {layer === 'armor' && turretArmor.length > 0 && (
          <div className="sb-armor-groups sb-turret-armor" aria-label="Turret armor">
            <span className="sb-lead">
              Turret armor <small>fixed by the gun</small>
            </span>
            {turretArmor.map(({ name, count, armor }) => (
              <p key={name}>
                <i
                  style={{
                    background: armorThicknessColor(Math.max(armor.armorMm, ...armor.plates.map((plate) => plate.thicknessMm)), armorScale),
                  }}
                />
                <span>
                  {name}
                  {count > 1 && <> ×{count}</>}
                  <small>{describeTurretArmor(armor)}</small>
                </span>
              </p>
            ))}
          </div>
        )}
      </aside>
      {drawer && (
        <div className="sb-drawer" ref={drawerRef} style={drawerSize} aria-label={`All ${drawerName}`}>
          <div className="sb-drawer-head">
            <span className="sb-lead">All {drawerName}</span>
            {(layer === 'fittings' || layer === 'hull') && (
              <label className="sb-search">
                Find{' '}
                <input
                  autoFocus
                  type="search"
                  aria-label={layer === 'hull' ? 'Find a shape' : 'Find a fitting'}
                  placeholder={layer === 'hull' ? 'bridge, cylinder, shell…' : 'gun, screw, funnel…'}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' || (event.key === '0' && !event.currentTarget.value)) {
                      event.preventDefault();
                      event.stopPropagation();
                      setDrawer(false);
                      setTip(undefined);
                    }
                  }}
                />
              </label>
            )}
            <button
              className="sb-drawer-close"
              aria-label="Close"
              onClick={() => {
                setDrawer(false);
                setTip(undefined);
              }}
            >
              ×
            </button>
          </div>
          {layer === 'hull' && hullFilters}
          <div className="sb-drawer-grid" role="listbox">
            {layer === 'fittings'
              ? FITTING_CATEGORIES.filter((shelf) => query || shelf.group === tab).map((shelf) => {
                  // The drawer holds every shelf of the tab and every nation at once, and a search reaches all three fitting tabs; choosing a card opens its shelf on the bar.
                  const cards = drawerItems.filter((item) => item.kind === 'part' && fittingCategory(item.part, catalog) === shelf.id);
                  return cards.length ? (
                    <div key={shelf.id} className="sb-drawer-shelf" role="group" aria-label={shelf.name}>
                      <span className="sb-lead">{shelf.name}</span>
                      <div>{cards.map((item) => slot(item))}</div>
                    </div>
                  ) : null;
                })
              : drawerItems.map((item) => slot(item))}
            {!drawerItems.length && <span className="sb-lead">No {layer === 'hull' ? 'shape' : 'fitting'} matches</span>}
          </div>
        </div>
      )}
      <div className="sb-dock">
        <div className="sb-dock-tabs">
          <nav className="sb-tabs" role="tablist" aria-label="Layers">
            {BUILDER_TABS.map((entry) => (
              <button key={entry.id} role="tab" aria-selected={tab === entry.id} title={entry.name} onClick={() => openTab(entry.id)}>
                <ToolGlyph name={entry.glyph} />
                <span>{entry.name}</span>
              </button>
            ))}
          </nav>
          <div className="sb-keys" aria-label="Hotkeys">
            {acting.length > 0 && <div className="sb-keys-row acting">{acting.map(chip)}</div>}
            {standing.length > 0 && <div className="sb-keys-row">{standing.map(chip)}</div>}
          </div>
        </div>
        {layer === 'hull' && !freeformMode && <div className="sb-shelves">{hullFilters}</div>}
        {layer === 'paint' && (
          <div className="sb-shelves sb-paint-finishes">
            <label className="sb-finish-select">
              Ship paint <i className="sb-ship-paint" style={{ background: constructionPaintColor(constructionShipPaint(source)) }} />
              <select
                className="sb-link"
                aria-label="Ship paint"
                title="Coats every face and fitting without a paint of its own"
                value={data.paint ?? ''}
                disabled={locked}
                onChange={(event) => tool.setShipPaint(event.target.value || undefined)}
              >
                {data.paint === undefined && <option value="">Original fittings</option>}
                {CONSTRUCTION_PAINTS.map((paint) => (
                  <option key={paint.id} value={paint.id}>
                    {paint.name}
                  </option>
                ))}
              </select>
            </label>
            <SurfaceFinishSelect value={data.finish} disabled={locked} onChange={tool.setFinish} />
            <span>Whole ship · cards below paint single faces and fittings</span>
          </div>
        )}
        {layer === 'fittings' && (
          <div className="sb-shelves">
            <div className="sb-chips" role="tablist" aria-label="Fitting shelves">
              {FITTING_CATEGORIES.filter((shelf) => shelf.group === tab).map((shelf) => (
                <button
                  key={shelf.id}
                  role="tab"
                  aria-selected={fittingFilter.category === shelf.id}
                  title={shelf.note}
                  onClick={() => {
                    tool.setFittingFilter({ category: shelf.id });
                    setTip(undefined);
                  }}
                >
                  {shelf.name}
                </button>
              ))}
            </div>
            {fittingFilter.category === 'custom' &&
              (active?.kind === 'part' && customFittingOf(data, { partId: active.part.id }) ? (
                <CustomFittingFields definition={customFittingOf(data, { partId: active.part.id })!} data={data} locked={locked} run={run} />
              ) : (
                <span className="sb-lead">
                  No custom fittings in this design yet. They are small non-structural shapes saved inside the design; agents define them with a
                  `fitting` command.
                </span>
              ))}
            {shelfNations.length > 0 && (
              <div className="sb-chips nations" role="radiogroup" aria-label="Nation">
                {(['all', ...shelfNations] as const).map((nation) => (
                  <button
                    key={nation}
                    role="radio"
                    aria-checked={tool.shelfNation === nation}
                    title={nation === 'all' ? 'Parts of every navy' : `${nation} parts, with the generic ones`}
                    onClick={() => tool.setFittingFilter({ nation })}
                  >
                    {nation === 'all' ? 'All' : NATION_SHORT[nation]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="sb-dock-body">
          <div className="sb-hotbar" role="toolbar" aria-label="Palette">
            <div className="sb-hotbar-cards" ref={hotbarRef}>
              {palette.drawer.map((item) => slot(item))}
            </div>
            {hasDrawer ? (
              <button
                className="sb-slot more"
                aria-expanded={drawer}
                aria-label={`All ${drawerName}`}
                onPointerEnter={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setTip({
                    title: `All ${drawerName}`,
                    detail: drawer ? 'close the full selection' : 'open the full selection',
                    x: rect.left + rect.width / 2,
                    y: tipTop(rect),
                    key: '0',
                  });
                }}
                onPointerLeave={hideTip}
                onClick={() => {
                  setDrawer((value) => !value);
                  setTip(undefined);
                }}
              >
                …
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {visibleTip && (
        <div
          ref={tooltipRef}
          className={`sb-tip ${visibleTip.below ? 'below' : ''} ${visibleTip.right !== undefined ? 'right' : ''} ${visibleTip.beside ? 'beside' : ''} ${visibleTip.detail ? '' : 'bare'}`}
          role="tooltip"
          style={
            visibleTip.right !== undefined ? { right: visibleTip.right, top: visibleTip.y } : { left: visibleTip.x, top: visibleTip.y }
          }
        >
          <b>{visibleTip.title}</b>
          {visibleTip.detail}
          {visibleTip.key && <kbd>{visibleTip.key}</kbd>}
        </div>
      )}
      {!data.primitives.length && (
        <div className="sb-empty">
          <b>This design needs a starting block</b>
          <button disabled={locked} onClick={() => run('Add starting block', [{ op: 'primitive', value: startingHullBlock() }])}>
            Add a hull block
          </button>{' '}
          to keep building.
        </div>
      )}
      {memoryOpen && (
        <ModelMemoryPanel
          source={source}
          catalog={catalog}
          result={compiledResult}
          visual={visualMemory}
          onClose={() => setMemoryOpen(false)}
        />
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </main>
  );
}

export { attachmentOffset };
