export type ComparisonMode = 'overlay' | 'side-by-side';
export type ViewName = 'quarter' | 'port' | 'starboard' | 'bow' | 'stern' | 'top' | 'bottom';
export const views: { name: ViewName; label: string; direction: [number, number, number]; up: [number, number, number] }[] = [
  { name: 'quarter', label: '3D', direction: [-1, .65, -1], up: [0, 1, 0] },
  { name: 'bow', label: 'Front', direction: [0, 0, -1], up: [0, 1, 0] },
  { name: 'stern', label: 'Rear', direction: [0, 0, 1], up: [0, 1, 0] },
  { name: 'port', label: 'Port side', direction: [-1, 0, 0], up: [0, 1, 0] },
  { name: 'starboard', label: 'Starboard side', direction: [1, 0, 0], up: [0, 1, 0] },
  { name: 'top', label: 'Top', direction: [0, 1, 0], up: [0, 0, 1] },
  { name: 'bottom', label: 'Bottom', direction: [0, -1, 0], up: [0, 0, 1] },
];

export const isSideView = (view: ViewName) => view === 'port' || view === 'starboard';

// WebGL rectangles start at the bottom left. Equal panels share one projection,
// camera target and zoom; independently fitting either model would hide differences.
export function comparisonPanels(width: number, height: number, mode: ComparisonMode, view: ViewName = 'quarter') {
  if (mode === 'overlay') return [{ x: 0, y: 0, width, height }];
  return width < 640 || isSideView(view)
    ? [{ x: 0, y: height / 2, width, height: height / 2 }, { x: 0, y: 0, width, height: height / 2 }]
    : [{ x: 0, y: 0, width: width / 2, height }, { x: width / 2, y: 0, width: width / 2, height }];
}
