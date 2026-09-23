import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BLEND_REACH,
  influence,
  sectionMetres,
  type Hull,
} from "../../ships/customHullModel";
import { MAX_HULL_SECTIONS } from "../../ships/customHullTopology";
import type { Blend } from "./customHullEditing";
import type { HullDrag, HullDragMove } from "./CustomHullViewport";

const pad = (i: number) => String(i + 1).padStart(2, "0");
const TAB_Y = 0,
  BAND_Y = 30,
  BAND_H = 34,
  AXIS_Y = 76;

/** Bow-to-stern strip: pick sections, slide them, add one between two, and set how far blending reaches. */
export function HullSectionRuler({
  hull: h,
  selected,
  blend,
  onSelect,
  onInsert,
  onReach,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  hull: Hull;
  selected: string[];
  blend: Blend;
  onSelect(id: string, additive: boolean): void;
  onInsert(index: number): void;
  onReach(reach: number): void;
  onDragStart(drag: HullDrag): void;
  onDragMove(move: HullDragMove): void;
  onDragEnd(): void;
  onDragCancel(): void;
}) {
  const host = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(1200);
  const drag = useRef<{
    pointer: number;
    x: number;
    moved: boolean;
    kind: "tab" | "reach";
    id?: string;
    side?: number;
    reach?: number;
  }>(undefined);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, entry.contentRect.width)),
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  const x0 = 46,
    x1 = width - 60,
    span = x1 - x0,
    X = (t: number) => x0 + t * span,
    perMetre = span / h.length;
  const halfBand = BAND_H / 2 - 2,
    beam = Math.max(
      ...h.stations.map((s) => Math.abs(sectionMetres(h, s).at(-1)!.x)),
      1e-6,
    ),
    scale = Math.min(halfBand / beam, perMetre * 1.6),
    mid = BAND_Y + BAND_H / 2;
  const top = h.stations.map(
      (s) =>
        `${X(s.t).toFixed(1)},${(mid - Math.abs(sectionMetres(h, s).at(-1)!.x) * scale).toFixed(1)}`,
    ),
    bottom = h.stations
      .map(
        (s) =>
          `${X(s.t).toFixed(1)},${(mid + Math.abs(sectionMetres(h, s).at(-1)!.x) * scale).toFixed(1)}`,
      )
      .reverse();
  const chosenT = h.stations
    .filter((s) => selected.includes(s.id))
    .map((s) => s.t);
  const low = Math.max(0, Math.min(...chosenT) - blend.reach),
    high = Math.min(1, Math.max(...chosenT) + blend.reach);
  const step = [5, 10, 20, 25, 50, 100].find((v) => h.length / v <= 8) ?? 100;
  const ticks = Array.from(
    { length: Math.floor(h.length / step) + 1 },
    (_, i) => i * step,
  );

  const down = (
    e: ReactPointerEvent<SVGElement>,
    kind: "tab" | "reach",
    id?: string,
    side?: number,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointer: e.pointerId,
      x: e.clientX,
      moved: false,
      kind,
      id,
      side,
      reach: blend.reach,
    };
  };
  const move = (e: ReactPointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 3) return;
    // SVG units per screen pixel, should the editor ever be drawn scaled.
    const scaleX =
      width / (host.current?.getBoundingClientRect().width || width) || 1;
    if (d.kind === "reach") {
      d.moved = true;
      onReach(
        Math.min(
          BLEND_REACH.max,
          Math.max(
            BLEND_REACH.min,
            d.reach! + (d.side! * (e.clientX - d.x) * scaleX) / span,
          ),
        ),
      );
      return;
    }
    const i = h.stations.findIndex((s) => s.id === d.id);
    if (i <= 0 || i >= h.stations.length - 1) return;
    if (!d.moved) onDragStart({ kind: "station", stationId: d.id });
    d.moved = true;
    onDragMove({
      delta: [0, 0, ((e.clientX - d.x) * scaleX) / perMetre],
      pixels: [0, 0, perMetre],
      alt: e.altKey,
    });
  };
  const up = (e: ReactPointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = undefined;
    if (d.kind === "reach") return;
    if (d.moved) onDragEnd();
    else if (d.id) onSelect(d.id, e.shiftKey);
  };
  const cancel = () => {
    const d = drag.current;
    drag.current = undefined;
    if (d?.moved && d.kind === "tab") onDragCancel();
  };

  return (
    <div className="hs-ruler" ref={host}>
      <svg
        width={width}
        height={AXIS_Y + 26}
        viewBox={`0 0 ${width} ${AXIS_Y + 26}`}
        role="group"
        aria-label="Sections from bow to stern"
      >
        <defs>
          <linearGradient id="hs-blend-band" x1="0" x2="1" y1="0" y2="0">
            {Array.from({ length: 41 }, (_, i) => i / 40).map((t) => (
              <stop
                key={t}
                offset={t}
                stopColor="#e0c58d"
                stopOpacity={
                  blend.soft
                    ? influence(h, selected, t, true, blend.reach) * 0.3
                    : 0
                }
              />
            ))}
          </linearGradient>
        </defs>
        {blend.soft && (
          <rect
            x={x0}
            y={BAND_Y - 4}
            width={span}
            height={BAND_H + 8}
            fill="url(#hs-blend-band)"
          />
        )}
        <path
          className="hs-ruler-hull"
          d={`M${[...top, ...bottom].join("L")}Z`}
        />
        <path className="hs-ruler-cl" d={`M${x0 - 10},${mid}H${x1 + 10}`} />
        {h.stations.map((s, i) => {
          const chosen = selected.includes(s.id),
            weight = influence(h, selected, s.t, blend.soft, blend.reach),
            percent = Math.round(weight * 100),
            state = chosen ? "selected" : weight > 0 ? "blended" : undefined,
            end = i === 0 || i === h.stations.length - 1;
          return (
            <g key={s.id} className="hs-ruler-station" data-state={state}>
              <path d={`M${X(s.t)},${BAND_Y - 3}V${BAND_Y + BAND_H + 3}`} />
              <rect
                className="hs-ruler-tab"
                x={X(s.t) - 14}
                y={TAB_Y + 3}
                width={28}
                height={19}
                rx={3}
                role="button"
                tabIndex={0}
                aria-pressed={chosen}
                aria-label={`Section ${pad(i)}${end ? "" : ": drag to move it along the hull"}`}
                style={{ cursor: end ? "pointer" : "ew-resize" }}
                onPointerDown={(e) => down(e, "tab", s.id)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.id, e.shiftKey);
                  }
                }}
              />
              <text
                className="hs-ruler-number"
                x={X(s.t)}
                y={TAB_Y + 16.5}
                textAnchor="middle"
              >
                {pad(i)}
              </text>
              {blend.soft && !chosen && weight > 0 && (
                <text
                  className="hs-ruler-percent"
                  x={X(s.t) + 17}
                  y={TAB_Y + 16.5}
                >
                  {percent < 1 ? "<1%" : `${percent}%`}
                </text>
              )}
            </g>
          );
        })}
        {blend.soft &&
          [
            [low, -1],
            [high, 1],
          ].map(([t, side]) => (
            <rect
              key={side}
              className="hs-ruler-reach"
              x={X(t) - 3.5}
              y={BAND_Y - 4}
              width={7}
              height={BAND_H + 8}
              rx={2}
              role="slider"
              aria-label="Blend reach"
              aria-valuenow={Math.round(blend.reach * h.length)}
              aria-valuetext={`${Math.round(blend.reach * h.length)} m either side`}
              onPointerDown={(e) => down(e, "reach", undefined, side)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={cancel}
            />
          ))}
        {blend.soft && (
          <text className="hs-ruler-reach-label" x={X(high) + 8} y={mid + 4}>
            ±{Math.round(blend.reach * h.length)} m
          </text>
        )}
        <path className="hs-ruler-axis" d={`M${x0},${AXIS_Y}H${x1}`} />
        {ticks.map((m) => (
          <text
            key={m}
            className="hs-ruler-tick"
            x={X(m / h.length)}
            y={AXIS_Y + 22}
            textAnchor="middle"
          >
            {m ? `${m} m` : "0"}
          </text>
        ))}
        {h.stations.slice(0, -1).map((s, i) => {
          const next = h.stations[i + 1];
          // Crowded gaps (many sections) keep their add button beside a selected section only.
          const crowded = (next.t - s.t) * span < 26;
          if (
            h.stations.length >= MAX_HULL_SECTIONS ||
            (crowded && !selected.includes(s.id) && !selected.includes(next.id))
          )
            return null;
          const x = X((s.t + next.t) / 2);
          return (
            <g
              key={s.id}
              className="hs-ruler-insert"
              data-crowded={crowded || undefined}
              transform={`translate(${x} ${AXIS_Y})`}
              role="button"
              tabIndex={0}
              aria-label={`Add a section between ${pad(i)} and ${pad(i + 1)}`}
              onClick={() => onInsert(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onInsert(i);
                }
              }}
            >
              <circle r={crowded ? 5 : 7} />
              <path d={crowded ? "M-2.5 0H2.5M0 -2.5V2.5" : "M-3.5 0H3.5M0 -3.5V3.5"} />
            </g>
          );
        })}
        <text
          className="hs-ruler-end hs-ruler-bow"
          x={x0 - 8}
          y={AXIS_Y + 4}
          textAnchor="end"
        >
          BOW
        </text>
        <text className="hs-ruler-end" x={x1 + 8} y={AXIS_Y + 4}>
          STERN
        </text>
      </svg>
    </div>
  );
}
