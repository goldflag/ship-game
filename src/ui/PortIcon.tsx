/** Line glyphs for the port's own controls: the quay, the plan chest and the tech tree. */
const PATHS = {
  pencil: <path d="M4 20h4L19 9l-4-4L4 16ZM13 7l4 4" />,
  grid: <path d="M4 4h7v7H4ZM13 4h7v7h-7ZM4 13h7v7H4ZM13 13h7v7h-7Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  left: <path d="m15 6-6 6 6 6" />,
  right: <path d="m9 6 6 6-6 6" />,
  /** Three plates joined: the research tree. */
  tree: <path d="M9 3h6v4H9ZM3 17h6v4H3ZM15 17h6v4h-6ZM12 7v5M6 17v-5h12v5" />,
  lock: (
    <>
      <path d="M5 11h14v9H5Z" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
} as const;
export type PortIconName = keyof typeof PATHS;

export function PortIcon({ name, size = 16 }: { name: PortIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
