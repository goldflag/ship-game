/** The research tree: one tree per nation, one column per line, oldest class at the top.
 *
 * Shared with the accounts API (copied into its image), so this folder imports nothing outside itself.
 * A node with a `presetId` is a modelled ship players can unlock and sail; a node without one is a
 * placeholder for a class that is not in the game yet. Placeholders never gate progress: a node's
 * prerequisite is the nearest modelled node above it in the same line. */

export const NATION_IDS = ['usa', 'japan', 'germany', 'uk'] as const;
export type NationId = typeof NATION_IDS[number];
export type LineId = 'destroyers' | 'cruisers' | 'battleships' | 'carriers' | 'submarines' | 'escorts';

export interface TechNode {
  /** Stable id. Modelled ships use their preset id. */
  id: string;
  /** The preset this node unlocks. Absent: not in the game yet. */
  presetId?: string;
  /** Shown on the node: the ship's name for modelled nodes, the class otherwise. */
  name: string;
  className: string;
  /** Detailed type, e.g. "Heavy cruiser". */
  type: string;
  /** Year the class (or the modelled fit) entered service. */
  year: number;
  /** XP to unlock; 0 for starters. */
  cost: number;
  /** Owned from the first visit. */
  starter?: true;
}
export interface TechLine { id: LineId; label: string; nodes: readonly TechNode[] }
export interface TechNation {
  id: NationId;
  /** Matches `shipIdentity().nation` and the `NationFlag` keys. */
  name: string;
  short: string;
  lines: readonly TechLine[];
}

type Row = [id: string, name: string, type: string, year: number, cost: number, extra?: { presetId?: string; className?: string; starter?: true }];
const line = (id: LineId, label: string, rows: Row[]): TechLine => ({
  id, label,
  nodes: rows.map(([nodeId, name, type, year, cost, extra = {}]) => ({
    id: nodeId, name, type, year, cost, className: extra.className ?? name,
    ...(extra.presetId ? { presetId: extra.presetId } : {}), ...(extra.starter ? { starter: true as const } : {}),
  })),
});
/** A modelled ship: its node id is its preset id. */
const ship = (presetId: string, name: string, className: string, type: string, year: number, cost: number, starter?: true): Row =>
  [presetId, name, type, year, cost, { presetId, className, ...(starter ? { starter } : {}) }];

export const TECH_TREE: readonly TechNation[] = [
  {
    id: 'usa', name: 'United States', short: 'US',
    lines: [
      line('destroyers', 'Destroyers', [
        ['us-clemson', 'Clemson', 'Destroyer', 1919, 800],
        ['us-farragut', 'Farragut', 'Destroyer', 1934, 800],
        ship('gleaves', 'Gleaves', 'Gleaves', 'Destroyer', 1940, 0, true),
        ship('fletcher', 'Fletcher', 'Fletcher', 'Destroyer', 1942, 1800),
        ['us-allen-m-sumner', 'Allen M. Sumner', 'Destroyer', 1944, 1800],
        ['us-gearing', 'Gearing', 'Destroyer', 1945, 1800],
      ]),
      line('cruisers', 'Cruisers', [
        ship('omaha', 'Omaha', 'Omaha', 'Light cruiser', 1923, 1500),
        ['us-pensacola', 'Pensacola', 'Heavy cruiser', 1930, 1500],
        ['us-new-orleans', 'New Orleans', 'Heavy cruiser', 1934, 1500],
        ['us-atlanta', 'Atlanta', 'Light cruiser', 1941, 2200],
        ship('cleveland', 'Cleveland', 'Cleveland', 'Light cruiser', 1942, 0, true),
        ship('baltimore', 'Baltimore', 'Baltimore', 'Heavy cruiser', 1943, 3000),
        ship('alaska', 'Alaska', 'Alaska', 'Large cruiser', 1944, 3000),
      ]),
      line('battleships', 'Battleships', [
        ['us-nevada', 'Nevada', 'Battleship', 1916, 3500],
        ['us-new-mexico', 'New Mexico', 'Battleship', 1918, 3500],
        ['us-colorado', 'Colorado', 'Battleship', 1921, 3500],
        ['us-north-carolina', 'North Carolina', 'Battleship', 1941, 6500],
        ['us-south-dakota', 'South Dakota', 'Battleship', 1942, 6500],
        ship('iowa', 'Iowa', 'Iowa', 'Battleship', 1943, 6500),
      ]),
      line('carriers', 'Carriers', [
        ['us-lexington', 'Lexington', 'Aircraft carrier', 1927, 5000],
        ['us-ranger', 'Ranger', 'Aircraft carrier', 1934, 5000],
        ship('enterprise-cv6', 'Enterprise', 'Yorktown', 'Aircraft carrier', 1938, 5000),
        ['us-essex', 'Essex', 'Aircraft carrier', 1942, 6500],
      ]),
    ],
  },
  {
    id: 'japan', name: 'Japan', short: 'JP',
    lines: [
      line('destroyers', 'Destroyers', [
        ['jp-minekaze', 'Minekaze', 'Destroyer', 1920, 800],
        ship('fubuki', 'Fubuki', 'Fubuki', 'Destroyer', 1928, 0, true),
        ['jp-akatsuki', 'Akatsuki', 'Destroyer', 1932, 800],
        ['jp-shiratsuyu', 'Shiratsuyu', 'Destroyer', 1936, 1200],
        ship('yukikaze', 'Yukikaze', 'Kagerō', 'Destroyer', 1940, 1200),
        ['jp-yugumo', 'Yūgumo', 'Destroyer', 1941, 1200],
        ['jp-akizuki', 'Akizuki', 'Destroyer', 1942, 1800],
      ]),
      line('cruisers', 'Cruisers', [
        ['jp-kuma', 'Kuma', 'Light cruiser', 1920, 1500],
        ['jp-furutaka', 'Furutaka', 'Heavy cruiser', 1926, 1500],
        ['jp-myoko', 'Myōkō', 'Heavy cruiser', 1929, 1500],
        ship('takao', 'Takao', 'Takao', 'Heavy cruiser', 1932, 1500),
        ship('mogami', 'Mogami', 'Mogami', 'Heavy cruiser', 1935, 0, true),
        ['jp-tone', 'Tone', 'Heavy cruiser', 1938, 2200],
        ['jp-agano', 'Agano', 'Light cruiser', 1942, 3000],
      ]),
      line('battleships', 'Battleships', [
        ship('kongo', 'Kongō', 'Kongō', 'Fast battleship', 1913, 3500),
        ['jp-fuso', 'Fusō', 'Battleship', 1915, 3500],
        ['jp-ise', 'Ise', 'Battleship', 1917, 3500],
        ['jp-nagato', 'Nagato', 'Battleship', 1920, 3500],
        ship('yamato', 'Yamato', 'Yamato', 'Battleship', 1941, 6500),
      ]),
      line('carriers', 'Carriers', [
        ['jp-hosho', 'Hōshō', 'Aircraft carrier', 1922, 3500],
        ['jp-akagi', 'Akagi', 'Aircraft carrier', 1927, 5000],
        ['jp-soryu', 'Sōryū', 'Aircraft carrier', 1937, 5000],
        ship('shokaku', 'Shōkaku', 'Shōkaku', 'Aircraft carrier', 1941, 6500),
        ['jp-taiho', 'Taihō', 'Aircraft carrier', 1944, 6500],
      ]),
    ],
  },
  {
    id: 'germany', name: 'Germany', short: 'DE',
    lines: [
      line('destroyers', 'Destroyers', [
        ['de-type-1934', 'Type 1934', 'Destroyer', 1937, 1200],
        ['de-type-1936', 'Type 1936', 'Destroyer', 1938, 1200],
        ['de-type-1936a', 'Type 1936A', 'Destroyer', 1940, 1200],
      ]),
      line('cruisers', 'Cruisers', [
        ['de-emden', 'Emden', 'Light cruiser', 1925, 1500],
        ['de-konigsberg', 'Königsberg', 'Light cruiser', 1929, 1500],
        ['de-leipzig', 'Leipzig', 'Light cruiser', 1931, 1500],
        ['de-deutschland', 'Deutschland', 'Heavy cruiser', 1933, 1500],
        ship('admiral-hipper', 'Admiral Hipper', 'Admiral Hipper', 'Heavy cruiser', 1939, 0, true),
      ]),
      line('battleships', 'Battleships', [
        ['de-scharnhorst', 'Scharnhorst', 'Battleship', 1939, 5000],
        ship('bismarck', 'Bismarck', 'Bismarck', 'Battleship', 1940, 6500),
      ]),
      line('carriers', 'Carriers', [
        ['de-graf-zeppelin', 'Graf Zeppelin', 'Aircraft carrier', 1938, 5000],
      ]),
      line('submarines', 'Submarines', [
        ship('type-viic', 'Type VIIC', 'Type VII', 'Submarine', 1940, 0, true),
        ['de-type-ixc', 'Type IXC', 'Submarine', 1941, 1200],
        ['de-type-xxi', 'Type XXI', 'Submarine', 1944, 1800],
      ]),
    ],
  },
  {
    id: 'uk', name: 'United Kingdom', short: 'UK',
    lines: [
      line('destroyers', 'Destroyers', [
        ['uk-v-and-w', 'V and W', 'Destroyer', 1917, 800],
        ['uk-tribal', 'Tribal', 'Destroyer', 1938, 1200],
        ['uk-j-class', 'J class', 'Destroyer', 1939, 1200],
        ['uk-battle', 'Battle', 'Destroyer', 1945, 1800],
      ]),
      line('cruisers', 'Cruisers', [
        ['uk-county', 'County', 'Heavy cruiser', 1928, 1500],
        ['uk-town', 'Town', 'Light cruiser', 1937, 2200],
        ['uk-dido', 'Dido', 'Light cruiser', 1940, 2200],
      ]),
      line('battleships', 'Battleships', [
        ['uk-queen-elizabeth', 'Queen Elizabeth', 'Battleship', 1915, 3500],
        ship('hood', 'Hood', 'Admiral', 'Battlecruiser', 1920, 3500),
        ['uk-nelson', 'Nelson', 'Battleship', 1927, 5000],
        ship('king-george-v', 'King George V', 'King George V', 'Battleship', 1940, 6500),
      ]),
      line('carriers', 'Carriers', [
        ['uk-courageous', 'Courageous', 'Aircraft carrier', 1928, 5000],
        ['uk-ark-royal', 'Ark Royal', 'Aircraft carrier', 1938, 5000],
        ['uk-illustrious', 'Illustrious', 'Aircraft carrier', 1940, 6500],
      ]),
      line('escorts', 'Escorts', [
        ship('flower-corvette', 'Flower', 'Flower', 'Corvette', 1940, 0, true),
        ['uk-river', 'River', 'Frigate', 1942, 1200],
        ['uk-castle', 'Castle', 'Corvette', 1944, 1800],
      ]),
    ],
  },
];

export interface NodePlace { nation: TechNation; line: TechLine; node: TechNode; index: number }
const places = new Map<string, NodePlace>();
const byPreset = new Map<string, NodePlace>();
for (const nation of TECH_TREE)
  for (const techLine of nation.lines)
    techLine.nodes.forEach((node, index) => {
      const place = { nation, line: techLine, node, index };
      places.set(node.id, place);
      if (node.presetId) byPreset.set(node.presetId, place);
    });

export const techNation = (id: NationId) => TECH_TREE.find(nation => nation.id === id)!;
export const nodePlace = (id: string) => places.get(id);
export const presetPlace = (presetId: string) => byPreset.get(presetId);
/** The nation whose tree holds this preset; undefined for enemy-only presets and player designs. */
export const presetNation = (presetId: string): NationId | undefined => byPreset.get(presetId)?.nation.id;
/** Every modelled node, tree order. */
export const modelledNodes = () => [...byPreset.values()].map(place => place.node);
/** The nearest modelled node above this one in its line: what must be owned first. */
export function prerequisite(id: string): TechNode | undefined {
  const place = places.get(id);
  if (!place) return undefined;
  for (let i = place.index - 1; i >= 0; i--) if (place.line.nodes[i].presetId) return place.line.nodes[i];
  return undefined;
}
