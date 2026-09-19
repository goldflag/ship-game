import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addHullPointPair,
  BLEND_REACH,
  canRemoveHullPointPair,
  clone,
  hullExtent,
  invalidReason,
  lockSymmetry,
  makeHull,
  presets,
  removeHullPointPair,
  sectionAt,
  sectionMetres,
  setSectionCount,
  uid,
  worldPoint,
  type Hull,
} from "../../ships/customHullModel";
import { editHullPaintBands, hullPaintBands, hullPaintHeightRange } from "../../ships/hullPaintBands";
import { HullPaintControls } from "./HullPaintControls";
import { MAX_HULL_POINTS } from "../../ships/customHullTopology";
import { defaultBilgeKeels } from "../../ships/constructionBilgeKeels";
import type { ConstructionSource, Vec3 } from "../../ships/blueprint";
import {
  applyReading,
  moveDeckKeel,
  movePoint,
  moveStation,
  pointName,
  rakeArm,
  resizeWidth,
  sectionReadings,
  type Blend,
  type ReadingKey,
} from "./customHullEditing";
import {
  DEFAULT_HULL_SNAP,
  heightTargets,
  HULL_SNAP_STEPS,
  pointTargets,
  SNAP_PIXELS,
  snapAxis,
  stationTargets,
  widthTargets,
  type AxisSnap,
  type HullSnapSettings,
} from "./customHullSnap";
import {
  CustomHullViewport,
  type HullDrag,
  type HullDragMove,
  type HullGuide,
  type HullView,
  type SafeArea,
} from "./CustomHullViewport";
import { HullSectionRuler } from "./HullSectionRuler";
import { NumberField } from "./NumberField";
import "./CustomHullEditor.css";

/** Native loading for the draft hull inside its design: the builder's compiler, not an estimate. */
export interface HullMeasurement {
  /** Waterline height in hull metres. */
  waterline: number;
  draft: number;
  displacementTonnes: number;
}
export type MeasureHull = (
  hull: Hull,
  signal: AbortSignal,
) => Promise<HullMeasurement>;

const SAFE: SafeArea = { left: 28, top: 70, right: 286, bottom: 206 };
/** The Section view frames its slice beside the docked tag rather than under it. */
const SECTION_SAFE: SafeArea = { ...SAFE, left: 400 };
const DOCK: [number, number] = [28, 70];
const VIEWS: { id: HullView; label: string; key: string; detail: string }[] = [
  {
    id: "orbit",
    label: "Orbit",
    key: "1",
    detail: "Edit on the model; drag space to orbit",
  },
  {
    id: "section",
    label: "Section",
    key: "2",
    detail: "Slice at the selected section and look forward",
  },
  {
    id: "plan",
    label: "Plan",
    key: "3",
    detail: "From above: drag deck edges to set widths",
  },
  {
    id: "profile",
    label: "Profile",
    key: "4",
    detail: "From port: deck, keel, stem rake and bulb",
  },
];
const pad = (i: number) => String(i + 1).padStart(2, "0");
const metres = (v: number) => Number(v.toFixed(2)).toString();

function Glyph({
  name,
}: {
  name:
    | "hull"
    | "undo"
    | "redo"
    | "down"
    | "left"
    | "right"
    | "remove"
    | "snap";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "hull" ? (
        <>
          <path d="M3 7h18l-4 11H7Z" />
          <path d="M7 7l3 11M17 7l-3 11M3 12h18" />
        </>
      ) : name === "undo" ? (
        <path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12h-3" />
      ) : name === "redo" ? (
        <path d="m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12h3" />
      ) : name === "down" ? (
        <path d="m7 10 5 5 5-5" />
      ) : name === "left" ? (
        <path d="m14 6-6 6 6 6" />
      ) : name === "right" ? (
        <path d="m10 6 6 6-6 6" />
      ) : name === "remove" ? (
        <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
      ) : (
        <path d="M4 4h16v16H4zM4 12h16M12 4v16" />
      )}
    </svg>
  );
}

export default function CustomHullEditor({
  integration,
}: {
  integration?: {
    hull: Hull;
    appearance?: ConstructionSource['construction'];
    designName?: string;
    measure?: MeasureHull;
    onApply(hull: Hull): void;
    onClose(): void;
  };
}) {
  const sessionDialog = useRef<HTMLDialogElement>(null),
    root = useRef<HTMLElement>(null),
    tag = useRef<HTMLDivElement>(null);
  const integrated = !!integration;
  // Open before the viewport measures its host and frames the hull.
  useLayoutEffect(() => {
    if (!integrated) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const dialog = sessionDialog.current!;
    dialog.showModal();
    // Start with the editor itself focused rather than its first button.
    root.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, [integrated]);
  useEffect(() => {
    const previous = document.title;
    document.title = "Hull sections · Shipbuilder";
    return () => {
      document.title = previous;
    };
  }, []);

  const [hull, setHull] = useState(() =>
    lockSymmetry(integration ? clone(integration.hull) : makeHull()),
  );
  const [pending, setPending] = useState<Hull>();
  const [past, setPast] = useState<Hull[]>([]),
    [future, setFuture] = useState<Hull[]>([]);
  const [selected, setSelected] = useState<string[]>(() => [
    hull.stations[Math.min(3, hull.stations.length - 1)].id,
  ]);
  const [point, setPoint] = useState(2);
  const [blend, setBlend] = useState<Blend>({
    soft: false,
    reach: BLEND_REACH.initial,
  });
  const [snap, setSnap] = useState<HullSnapSettings>(DEFAULT_HULL_SNAP),
    [altHeld, setAltHeld] = useState(false),
    [snapMenu, setSnapMenu] = useState(false);
  const [view, setView] = useState<HullView>("orbit"),
    [fit, setFit] = useState(0),
    [focus, setFocus] = useState(0);
  const [starter, setStarter] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [feedback, setFeedback] = useState<{
    text: string;
    guides: HullGuide[];
  }>();
  const [measured, setMeasured] = useState<{
    hull: Hull;
    value?: HullMeasurement;
    failure?: string;
  }>();
  const drag = useRef<{ spec: HullDrag; base: Hull; draft?: Hull }>(undefined);
  const latest = useRef(hull);
  latest.current = hull;

  const shown = pending ?? hull;
  const valid = selected.filter((id) =>
    shown.stations.some((s) => s.id === id),
  );
  const selection = valid.length
    ? valid
    : [shown.stations[Math.min(3, shown.stations.length - 1)].id];
  const primary = shown.stations.find((s) => selection.includes(s.id))!;
  const primaryIndex = shown.stations.indexOf(primary);
  const k0 = Math.min(point, primary.points.length - 1);
  const multi = selection.length > 1;
  const waterline = measured?.value?.waterline;
  const snapping = snap.enabled !== altHeld;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(timer);
  }, [notice]);
  // Measure the committed hull a moment after it settles; drags keep the last waterline.
  // The builder hands over its measuring compiler once that has started.
  const measure = useRef(integration?.measure);
  measure.current = integration?.measure;
  const measurable = !!integration?.measure;
  useEffect(() => {
    if (!measurable) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      measure.current?.(hull, abort.signal).then(
        (value) => {
          if (!abort.signal.aborted) setMeasured({ hull, value });
        },
        (cause) => {
          if (!abort.signal.aborted)
            setMeasured((previous) => ({
              hull,
              value: previous?.value,
              failure: cause instanceof Error ? cause.message : String(cause),
            }));
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [hull, measurable]);
  if (import.meta.env.DEV)
    (window as unknown as { hullSectionsEditor?: object }).hullSectionsEditor =
      {
        hull: () => clone(latest.current),
      };

  const commit = (
    next: Hull,
    extra?: { select?: string[]; point?: number },
  ) => {
    const reason = invalidReason(next);
    if (reason) {
      setNotice(`Not applied · ${reason}`);
      return false;
    }
    setPast((value) => [...value.slice(-49), latest.current]);
    setFuture([]);
    setHull(next);
    setError("");
    if (extra?.select) setSelected(extra.select);
    if (extra?.point !== undefined) setPoint(extra.point);
    return true;
  };
  const edit = (
    change: (draft: Hull) => void,
    extra?: { select?: string[]; point?: number },
  ) => {
    const next = clone(hull);
    change(next);
    return commit(next, extra);
  };
  const undo = () => {
    if (!past.length || pending) return;
    setFuture((value) => [hull, ...value]);
    setHull(past[past.length - 1]);
    setPast((value) => value.slice(0, -1));
    setError("");
  };
  const redo = () => {
    if (!future.length || pending) return;
    setPast((value) => [...value, hull]);
    setHull(future[0]);
    setFuture((value) => value.slice(1));
    setError("");
  };
  const select = (id: string, additive = false) =>
    setSelected((previous) => {
      const current = previous.filter((v) =>
        hull.stations.some((s) => s.id === v),
      );
      if (!additive) return [id];
      if (!current.includes(id)) return [...current, id];
      return current.length > 1 ? current.filter((v) => v !== id) : current;
    });
  const step = (direction: 1 | -1) =>
    setSelected([
      hull.stations[
        Math.max(
          0,
          Math.min(hull.stations.length - 1, primaryIndex + direction),
        )
      ].id,
    ]);

  // Drags: the viewport and ruler report metres moved; snapping settles the target, then the draft follows.
  const dragResult = (spec: HullDrag, base: Hull, move: HullDragMove) => {
    const enabled = snap.enabled !== move.alt,
      extent = hullExtent(base),
      guides: HullGuide[] = [],
      held: string[] = [];
    const options = (axis: 0 | 1 | 2, origin?: number) => ({
      settings: snap,
      enabled,
      threshold: SNAP_PIXELS / Math.max(move.pixels[axis], 1e-6),
      origin,
    });
    const note = (result: AxisSnap, from: () => Vec3) => {
      if (!result.target) return;
      held.push(result.target.label);
      if (snap.guides)
        guides.push(
          result.target.at
            ? { from: from(), to: result.target.at }
            : { from: from(), level: result.target.value },
        );
    };
    const s = base.stations.find((v) => v.id === spec.stationId),
      i = s ? base.stations.indexOf(s) : -1;
    let next = base,
      text = "";
    if (spec.kind === "point" && s) {
      const k = spec.point!,
        m = sectionMetres(base, s)[k],
        keel = (s.points.length - 1) / 2;
      // A free drag leaves an axis alone until the pointer really moves along it.
      const moves = (axis: 0 | 1) =>
        Math.abs(move.delta[axis]) * move.pixels[axis] >= 4;
      const out =
          k !== keel && moves(0)
            ? snapAxis(
                m.x + move.delta[0],
                pointTargets(base, s.id, k, "x", snap, waterline),
                options(0),
              )
            : { value: m.x },
        up = moves(1)
          ? snapAxis(
              m.y + move.delta[1],
              pointTargets(base, s.id, k, "y", snap, waterline),
              options(1, extent.base),
            )
          : { value: m.y };
      const x = out.value,
        y = up.value,
        where = () =>
          worldPoint(base, s.t, { x: x / (base.beam / 2), y: y / base.depth });
      note(out, where);
      note(up, where);
      next = movePoint(base, selection, blend, k, x - m.x, y - m.y);
      text = `${pointName(s, k)} · out ${metres(Math.abs(x))} m · up ${metres(y - extent.base)} m`;
    }
    if (spec.kind === "station" && s) {
      const z = s.t * base.length,
        result = snapAxis(
          z + move.delta[2],
          stationTargets(base, s.id, snap),
          options(2, 0),
        );
      next = moveStation(base, s.id, result.value - z);
      const t = next.stations[i].t;
      note(result, () => worldPoint(next, t, { x: 0, y: 0.45 }));
      text = `Section ${pad(i)} · ${metres(t * base.length)} m from the bow`;
    }
    if (spec.kind === "width" && s) {
      const m = sectionMetres(base, s),
        half = m[m.length - 1].x,
        result = snapAxis(
          half + move.delta[0],
          widthTargets(base, s.id, snap),
          options(0, 0),
        );
      next = resizeWidth(base, selection, blend, s.id, result.value - half);
      note(result, () =>
        worldPoint(base, s.t, {
          x: result.value / (base.beam / 2),
          y: m[m.length - 1].y / base.depth,
        }),
      );
      text = `Section ${pad(i)} · width ${metres(result.value * 2)} m`;
    }
    if ((spec.kind === "deck" || spec.kind === "keel") && s) {
      const keel = spec.kind === "keel",
        m = sectionMetres(base, s),
        p = m[keel ? (m.length - 1) / 2 : 0],
        result = snapAxis(
          p.y + move.delta[1],
          heightTargets(base, s.id, keel, snap),
          options(1, extent.base),
        );
      next = moveDeckKeel(
        base,
        selection,
        blend,
        s.id,
        keel,
        result.value - p.y,
      );
      note(result, () =>
        worldPoint(base, s.t, {
          x: p.x / (base.beam / 2),
          y: result.value / base.depth,
        }),
      );
      text = `Section ${pad(i)} · ${spec.kind} ${metres(result.value - extent.base)} m above the base`;
    }
    if (spec.kind === "rake" || spec.kind === "bulb") {
      const rake = spec.kind === "rake",
        raw = rake
          ? base.rake + move.delta[2] / rakeArm(base)
          : base.bulb - move.delta[2] / (base.depth * 0.7),
        percent = enabled && snap.grid ? Math.round(raw * 20) / 20 : raw,
        value = Math.min(rake ? 1.5 : 1, Math.max(0, percent));
      next = clone(base);
      next[spec.kind] = value;
      text = `${rake ? "Stem rake" : "Bow bulb"} ${Math.round(value * 100)} %`;
    }
    if (spec.kind === "paint" && spec.bandId) {
      const bands = hullPaintBands(base), index = bands.findIndex(b => b.id === spec.bandId);
      if (index < 0) return { next, text, guides };
      const [min, max] = hullPaintHeightRange(bands, index, extent.base, extent.deck);
      const targets =
        waterline === undefined
          ? []
          : [{ value: waterline, label: "the waterline", level: true }];
      const result = snapAxis(
        bands[index].upperY + move.delta[1],
        snap.levels ? targets : [],
        options(1, extent.base),
      );
      next = clone(base);
      const band = editHullPaintBands(next)[index];
      band.upperY = Math.min(max, Math.max(min, result.value));
      if (result.target) held.push(result.target.label);
      text = `Band ${index + 1} · ${metres(band.upperY - extent.base)} m above the base`;
    }
    if (held.length) text += ` · snapped to ${held.join(" and ")}`;
    return { next, text, guides };
  };
  const dragStart = (spec: HullDrag) => {
    drag.current = { spec, base: hull };
    setError("");
  };
  const dragMove = (move: HullDragMove) => {
    const d = drag.current;
    if (!d) return;
    const result = dragResult(d.spec, d.base, move);
    d.draft = result.next;
    setPending(result.next);
    setError(invalidReason(result.next) ?? "");
    setFeedback({ text: result.text, guides: result.guides });
  };
  const dragEnd = () => {
    const d = drag.current;
    drag.current = undefined;
    setPending(undefined);
    setFeedback(undefined);
    setError("");
    if (d?.draft && d.draft !== d.base) commit(d.draft);
  };
  const dragCancel = () => {
    drag.current = undefined;
    setPending(undefined);
    setFeedback(undefined);
    setError("");
  };
  const nudge = (k: number, axis: 0 | 1, sign: 1 | -1) => {
    const amount = (snapping ? snap.step : 0.1) * sign;
    setPoint(k);
    commit(
      movePoint(
        hull,
        selection,
        blend,
        k,
        axis === 0 ? amount : 0,
        axis === 1 ? amount : 0,
      ),
    );
  };
  const pair = (add: boolean, k = k0) => {
    const points = hull.stations[0].points;
    if (
      add
        ? points.length >= MAX_HULL_POINTS
        : !canRemoveHullPointPair(points, k)
    )
      return;
    let nextPoint = k;
    if (
      edit((draft) => {
        nextPoint = add
          ? addHullPointPair(draft, k)
          : removeHullPointPair(draft, k);
      })
    )
      setPoint(nextPoint);
  };
  const reading = (key: ReadingKey, value: number) =>
    commit(applyReading(hull, selection, blend, primary, key, value));
  const insert = (index: number) => {
    if (hull.stations.length >= 24) return;
    const id = uid();
    edit(
      (draft) => {
        const s = sectionAt(
          draft,
          (draft.stations[index].t + draft.stations[index + 1].t) / 2,
        );
        s.id = id;
        draft.stations.splice(index + 1, 0, s);
      },
      { select: [id] },
    );
  };
  const ends = [
    hull.stations[0].id,
    hull.stations[hull.stations.length - 1].id,
  ];
  const removable =
    !selection.some((id) => ends.includes(id)) &&
    hull.stations.length - selection.length >= 4;
  const removeSections = () => {
    if (!removable) return;
    const keep = hull.stations.filter((s) => !selection.includes(s.id));
    const neighbour = keep.reduce((a, b) =>
      Math.abs(a.t - primary.t) <= Math.abs(b.t - primary.t) ? a : b,
    );
    edit(
      (draft) => {
        draft.stations = draft.stations.filter(
          (s) => !selection.includes(s.id),
        );
      },
      { select: [neighbour.id] },
    );
  };
  const count = (next: number) => {
    if (next < 4 || next > 24 || next === hull.stations.length) return;
    const draft = clone(hull);
    setSectionCount(draft, next);
    const near = draft.stations.reduce((a, b) =>
      Math.abs(a.t - primary.t) <= Math.abs(b.t - primary.t) ? a : b,
    );
    commit(draft, { select: [near.id] });
  };
  const dimension = (key: "length" | "beam" | "depth", value: number) =>
    edit((draft) => {
      draft[key] = value;
    });
  const extent = hullExtent(shown);
  const loadStarter = (index: number) => {
    const fresh = makeHull(index);
    fresh.id = hull.id;
    fresh.offset = hull.offset;
    if (commit(fresh, { select: [fresh.stations[3].id], point: 2 })) {
      setFit((value) => value + 1);
      setNotice(
        `${presets[index].name} starter loaded · Undo brings your hull back`,
      );
    }
    setStarter(false);
  };

  // Editor keys; fields keep their own typing. Alt/Option inverts snapping while held.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(true);
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable]")) return;
      const lower = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && lower === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && lower === "a") {
        e.preventDefault();
        setSelected(hull.stations.map((s) => s.id));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && (starter || snapMenu)) {
        e.preventDefault();
        setStarter(false);
        setSnapMenu(false);
        return;
      }
      const chosen = VIEWS.find((v) => v.key === e.key);
      if (chosen) {
        e.preventDefault();
        setView(chosen.id);
      } else if (e.key === "Home") {
        e.preventDefault();
        setFit((value) => value + 1);
      } else if (lower === "f" && !e.repeat) {
        e.preventDefault();
        setView("orbit");
        setFocus((value) => value + 1);
      } else if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        step(e.key === "[" ? -1 : 1);
      } else if (lower === "n" && !e.repeat) {
        e.preventDefault();
        setSnap((value) => ({ ...value, enabled: !value.enabled }));
      } else if (lower === "s" && !e.repeat) {
        e.preventDefault();
        setSnap((value) => ({
          ...value,
          step: HULL_SNAP_STEPS[
            (HULL_SNAP_STEPS.indexOf(value.step) + 1) % HULL_SNAP_STEPS.length
          ],
        }));
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(false);
    };
    const blur = () => setAltHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });

  const readings = sectionReadings(shown, primary);
  const hint = error
    ? error
    : (feedback?.text ??
      (view === "orbit"
        ? `Drag a point or its X, Y and Z arms · click a ring to pick a section, ⇧ to add · F moves in · drag space to orbit`
        : view === "section"
          ? `Section ${pad(primaryIndex)} from astern, looking forward · the outlines inside are the sections ahead`
          : view === "plan"
            ? "Drag a deck edge to widen or narrow its section · starboard is up, bow to the left"
            : "Drag deck and keel points for the sheer and keel line · the brass diamonds rake the stem and grow a bulb"));
  const measurement = measured?.value,
    stale = !!measured && measured.hull !== hull;
  const sectionTitle = multi
    ? `${selection.length} sections`
    : `Section ${pad(primaryIndex)}`;
  const sectionPlace = multi
    ? selection
        .map((id) => pad(hull.stations.findIndex((s) => s.id === id)))
        .join(" · ")
    : primaryIndex === 0
      ? "bow"
      : primaryIndex === shown.stations.length - 1
        ? "stern"
        : `${metres(primary.t * shown.length)} m from the bow`;
  const pointMetres = sectionMetres(shown, primary)[k0];

  const content = (
    <main
      ref={root}
      tabIndex={-1}
      className={`hs-root${error ? " hs-invalid" : ""}${integration ? " hs-integrated" : ""}`}
      data-view={view}
      aria-label="Hull sections"
    >
      <CustomHullViewport
        hull={shown}
        appearance={integration?.appearance}
        view={view}
        fit={fit}
        focus={focus}
        selected={selection}
        primary={primary.id}
        point={k0}
        blend={blend}
        invalid={!!pending && !!error}
        waterline={waterline}
        guides={feedback?.guides ?? []}
        safe={view === "section" ? SECTION_SAFE : SAFE}
        dock={DOCK}
        tag={tag}
        onSelectStation={select}
        onSelectPoint={setPoint}
        onDragStart={dragStart}
        onDragMove={dragMove}
        onDragEnd={dragEnd}
        onDragCancel={dragCancel}
        onNudge={nudge}
        onRemovePair={(k) => pair(false, k)}
      />
      <header className="hs-top">
        <div className="hs-title">
          <Glyph name="hull" />
          <b>Hull sections</b>
          {integration?.designName && <span>{integration.designName}</span>}
        </div>
        <div className="hs-actions">
          <button
            className="hs-undo"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!past.length || !!pending}
            onClick={undo}
          >
            <Glyph name="undo" />
            {past.length}
          </button>
          <button
            className="hs-undo"
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!future.length || !!pending}
            onClick={redo}
          >
            <Glyph name="redo" />
            {future.length}
          </button>
          <button
            className="hs-button"
            aria-expanded={starter}
            onClick={() => setStarter(!starter)}
          >
            Starter
            <Glyph name="down" />
          </button>
          {integration && (
            <>
              <button className="hs-button" onClick={integration.onClose}>
                Cancel
              </button>
              <button
                className="hs-cmd"
                disabled={!!pending || !!error}
                onClick={() => integration.onApply(hull)}
              >
                Apply hull
              </button>
            </>
          )}
        </div>
      </header>

      <aside className="hs-ledger" aria-label="Hull">
        <h4>Hull</h4>
        <div className="row">
          <span>Length</span>
          <NumberField
            label="Length"
            value={hull.length}
            min={5}
            max={500}
            step={1}
            unit="m"
            onChange={(v) => dimension("length", v)}
          />
        </div>
        <div className="row">
          <span>Beam</span>
          <NumberField
            label="Beam"
            value={hull.beam}
            min={1}
            max={100}
            step={0.5}
            unit="m"
            onChange={(v) => dimension("beam", v)}
          />
        </div>
        <div className="row">
          <span>Depth</span>
          <NumberField
            label="Depth"
            value={hull.depth}
            min={1}
            max={60}
            step={0.5}
            unit="m"
            onChange={(v) => dimension("depth", v)}
          />
        </div>
        <div className="row">
          <span>Sections</span>
          <span className="hs-stepper">
            <button
              aria-label="Fewer sections"
              disabled={hull.stations.length <= 4 || !!pending}
              onClick={() => count(hull.stations.length - 1)}
            >
              −
            </button>
            <b>{hull.stations.length}</b>
            <button
              aria-label="More sections"
              disabled={hull.stations.length >= 24 || !!pending}
              onClick={() => count(hull.stations.length + 1)}
            >
              +
            </button>
          </span>
        </div>
        {integration?.measure && (
          <>
            <div
              className="row"
              data-stale={stale || undefined}
              title={
                measured?.failure ??
                "Floats the draft hull with the design's current loading"
              }
            >
              <span>Draft</span>
              <b className="hs-water">
                {measurement ? `${metres(measurement.draft)} m` : "—"}
              </b>
            </div>
            <div className="row" data-stale={stale || undefined}>
              <span>Displacement</span>
              <b>
                {measurement
                  ? `${Math.round(measurement.displacementTonnes).toLocaleString()} t`
                  : "—"}
              </b>
            </div>
          </>
        )}
        <h4>Bow</h4>
        <div className="row">
          <span>Stem rake</span>
          <NumberField
            label="Stem rake"
            value={hull.rake * 100}
            min={0}
            max={150}
            step={5}
            digits={0}
            unit="%"
            onChange={(v) =>
              edit((d) => {
                d.rake = v / 100;
              })
            }
          />
        </div>
        <div className="row">
          <span>Bow bulb</span>
          <NumberField
            label="Bow bulb"
            value={hull.bulb * 100}
            min={0}
            max={100}
            step={5}
            digits={0}
            unit="%"
            onChange={(v) =>
              edit((d) => {
                d.bulb = v / 100;
              })
            }
          />
        </div>
        <HullPaintControls hull={hull} waterline={waterline} measurable={!!integration?.measure} edit={edit} />
        <h4>Bilge keels</h4>
        <div className="row">
          <label className="hs-check hs-keel-check">
            <input type="checkbox" checked={hull.bilgeKeels?.enabled ?? false} onChange={() => edit(d => {
              d.bilgeKeels ??= { ...defaultBilgeKeels(d.beam), enabled: false };
              d.bilgeKeels.enabled = !d.bilgeKeels.enabled;
            })} />
            Symmetric pair
          </label>
        </div>
        {hull.bilgeKeels?.enabled && <>
          <p className="hs-keel-help">Follows both sides of the hull. Visual only.</p>
          <div className="row"><span>Length</span><NumberField label="Bilge keel length" unit="%" digits={1} value={(hull.bilgeKeels.end-hull.bilgeKeels.start)*100} min={2} max={96} step={1} onChange={v => edit(d => {
            const k=d.bilgeKeels!, length=v/100, center=(k.start+k.end)/2;
            k.start=Math.max(.02,Math.min(.98-length,center-length/2)); k.end=k.start+length;
          })} /></div>
          <div className="row"><span>Center from bow</span><NumberField label="Bilge keel center from bow" unit="%" digits={1} value={(hull.bilgeKeels.start+hull.bilgeKeels.end)*50} min={2+(hull.bilgeKeels.end-hull.bilgeKeels.start)*50} max={98-(hull.bilgeKeels.end-hull.bilgeKeels.start)*50} step={1} onChange={v => edit(d => {
            const k=d.bilgeKeels!, half=(k.end-k.start)/2; k.start=v/100-half; k.end=v/100+half;
          })} /></div>
          <div className="row"><span>Width</span><NumberField label="Bilge keel width" unit="m" value={hull.bilgeKeels.widthM} min={Math.max(.05,hull.bilgeKeels.thicknessM)} max={3} step={.05} onChange={v => edit(d => { d.bilgeKeels!.widthM=v; })} /></div>
          <div className="row"><span>Thickness</span><NumberField label="Bilge keel thickness" unit="mm" digits={0} value={hull.bilgeKeels.thicknessM*1000} min={5} max={Math.min(100,hull.bilgeKeels.widthM*1000)} step={1} onChange={v => edit(d => { d.bilgeKeels!.thicknessM=v/1000; })} /></div>
          <div className="row"><span>Keel → deck</span><NumberField label="Bilge keel placement from keel to deck" unit="%" digits={0} value={hull.bilgeKeels.placement*100} min={5} max={80} step={1} onChange={v => edit(d => { d.bilgeKeels!.placement=v/100; })} /></div>
        </>}
      </aside>

      <div className="hs-tag" ref={tag} role="group" aria-label={sectionTitle}>
        <div className="hs-tag-head">
          <button
            className="hs-icon"
            aria-label="Previous section"
            title="Previous section ([)"
            disabled={primaryIndex === 0 && !multi}
            onClick={() => step(-1)}
          >
            <Glyph name="left" />
          </button>
          <b>{sectionTitle}</b>
          <button
            className="hs-icon"
            aria-label="Next section"
            title="Next section (])"
            disabled={primaryIndex === shown.stations.length - 1 && !multi}
            onClick={() => step(1)}
          >
            <Glyph name="right" />
          </button>
          <span>{sectionPlace}</span>
          <button
            className="hs-icon hs-remove"
            aria-label="Remove section"
            title={
              removable
                ? "Remove section"
                : "The bow and stern stay, with at least four sections"
            }
            disabled={!removable || !!pending}
            onClick={removeSections}
          >
            <Glyph name="remove" />
          </button>
        </div>
        <div className="hs-readings">
          {(
            [
              ["width", "Width", "m", 0.1, 0, 200],
              ["deck", "Deck", "m", 0.1, 0.1, 120],
              ["flare", "Flare", "%", 1, -100, 100],
              ["bilge", "Bilge", "%", 1, -100, 100],
            ] as const
          ).map(([key, label, unit, stepSize, min, max]) => (
            <div key={key} className="hs-reading">
              <span>{label}</span>
              <NumberField
                label={`Section ${label.toLowerCase()}`}
                value={readings[key]}
                min={min}
                max={max}
                step={stepSize}
                digits={unit === "%" ? 0 : 2}
                unit={unit}
                onChange={(v) => reading(key, v)}
              />
            </div>
          ))}
        </div>
        <div className="hs-point">
          <b>{pointName(primary, k0)}</b>
          <span>
            out <em>{metres(Math.abs(pointMetres.x))}</em> · up{" "}
            <em>{metres(pointMetres.y - extent.base)}</em> m
          </span>
          <button
            className="hs-small"
            title="Add a pair and evenly redistribute points along each section's current outline"
            disabled={primary.points.length >= MAX_HULL_POINTS || !!pending}
            onClick={() => pair(true)}
          >
            + Pair
          </button>
          <button
            className="hs-small"
            title={
              canRemoveHullPointPair(primary.points, k0)
                ? "Remove a pair and evenly redistribute points along each section's current outline"
                : "Deck edges and the keel stay; sections keep at least five points"
            }
            disabled={!canRemoveHullPointPair(primary.points, k0) || !!pending}
            onClick={() => pair(false)}
          >
            − Pair
          </button>
        </div>
        <button
          className="hs-blend"
          aria-pressed={blend.soft}
          title="Edits also move nearby sections, fading with distance. Drag the band's ends on the ruler to set the reach."
          onClick={() => setBlend({ ...blend, soft: !blend.soft })}
        >
          <i />
          Blend nearby sections
        </button>
      </div>

      <p
        className={`hs-hint${error ? " bad" : feedback ? " live" : ""}`}
        role="status"
      >
        {hint}
      </p>

      <HullSectionRuler
        hull={shown}
        selected={selection}
        blend={blend}
        onSelect={select}
        onInsert={insert}
        onReach={(reach) => setBlend({ ...blend, reach })}
        onDragStart={dragStart}
        onDragMove={dragMove}
        onDragEnd={dragEnd}
        onDragCancel={dragCancel}
      />

      <div className="hs-corner">
        <div className="hs-snap" data-override={altHeld || undefined}>
          <button
            className="hs-snap-main"
            aria-pressed={snapping}
            aria-label={`Snapping ${snapping ? "on" : "off"}`}
            title="N toggles snapping; hold Alt/Option to invert it while dragging"
            onClick={() => setSnap({ ...snap, enabled: !snap.enabled })}
          >
            <Glyph name="snap" />
            Snap {snapping ? "on" : "off"}
            <kbd>N</kbd>
          </button>
          <button
            className="hs-snap-more"
            aria-label="Snap settings"
            aria-expanded={snapMenu}
            onClick={() => setSnapMenu(!snapMenu)}
          >
            <Glyph name="down" />
          </button>
          <button
            className="hs-snap-step"
            aria-label={`Snap step ${snap.step} m; cycle with S`}
            title="Snap step · S to cycle"
            onClick={() =>
              setSnap({
                ...snap,
                step: HULL_SNAP_STEPS[
                  (HULL_SNAP_STEPS.indexOf(snap.step) + 1) %
                    HULL_SNAP_STEPS.length
                ],
              })
            }
          >
            {snap.step} m<kbd>S</kbd>
          </button>
          {snapMenu && (
            <div
              className="hs-snap-menu"
              role="group"
              aria-label="Snap settings"
            >
              <strong>Snap to</strong>
              {(
                [
                  ["grid", "Grid"],
                  ["sections", "Neighbouring sections and points"],
                  ["levels", "Waterline, deck and base"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={snap[key]}
                    onChange={(e) =>
                      setSnap({ ...snap, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
              <div
                className="hs-snap-steps"
                role="group"
                aria-label="Snap step"
              >
                {HULL_SNAP_STEPS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={snap.step === value}
                    onClick={() => setSnap({ ...snap, step: value })}
                  >
                    {value}
                  </button>
                ))}
                <span>m</span>
              </div>
              <strong>Show</strong>
              <label>
                <input
                  type="checkbox"
                  checked={snap.guides}
                  onChange={(e) =>
                    setSnap({ ...snap, guides: e.target.checked })
                  }
                />
                Alignment guides
              </label>
              <p>
                Stem rake and bulb snap to 5 %. <kbd>N</kbd> toggles,{" "}
                <kbd>S</kbd> cycles the step, hold <kbd>Alt</kbd> to invert.
              </p>
            </div>
          )}
        </div>
        <div className="hs-views" role="toolbar" aria-label="View">
          <span className="hs-cap">View</span>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              aria-pressed={view === v.id}
              title={`${v.detail} (${v.key})`}
              onClick={() => setView(v.id)}
            >
              {v.label}
              <kbd>{v.key}</kbd>
            </button>
          ))}
          <button
            title="Move in on the selected section (F)"
            onClick={() => {
              setView("orbit");
              setFocus((value) => value + 1);
            }}
          >
            Focus
            <kbd>F</kbd>
          </button>
          <button
            title="Frame the whole hull (Home)"
            onClick={() => setFit((value) => value + 1)}
          >
            Fit
          </button>
        </div>
      </div>

      {starter && (
        <>
          <div className="hs-scrim" onClick={() => setStarter(false)} />
          <section className="hs-starters" aria-label="Hull starters">
            <div className="hs-starters-head">
              <b>Start from a hull</b>
              <span>Replaces this hull · Undo brings it back</span>
            </div>
            <div className="hs-starter-list">
              {presets.map((p, i) => {
                const h = makeHull(i),
                  k = Math.min(140 / h.length, 36 / h.beam),
                  edge = h.stations.map((s) => [
                    10 + s.t * h.length * k,
                    sectionMetres(h, s).at(-1)!.x * k,
                  ]);
                const d = `M${[...edge.map(([x, y]) => `${x},${22 - y}`), ...edge.reverse().map(([x, y]) => `${x},${22 + y}`)].join("L")}Z`;
                return (
                  <button key={p.name} onClick={() => loadStarter(i)}>
                    <svg viewBox="0 0 160 44" aria-hidden="true">
                      <path d={d} />
                    </svg>
                    <b>{p.name}</b>
                    <span>{p.note}</span>
                    <small>
                      {Number(p.length.toFixed(2))} × {Number(p.beam.toFixed(2))} × {Number(p.depth.toFixed(2))} m
                    </small>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}
      {notice && (
        <p className="hs-notice" role="status">
          {notice}
        </p>
      )}
    </main>
  );
  return integration ? (
    <dialog
      ref={sessionDialog}
      className="hs-session"
      aria-label="Hull sections editor"
      onCancel={(event) => {
        event.preventDefault();
        integration.onClose();
      }}
    >
      {content}
    </dialog>
  ) : (
    content
  );
}
