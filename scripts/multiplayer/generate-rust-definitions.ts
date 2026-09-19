/** Compile the existing definition type into Rust input types. No second authoring schema. */
import ts from 'typescript';
import { rustTool } from './toolchain';

export const DEFINITION_PATH = 'crates/naval-sim/src/definition.rs';
/**
 * Optional fields added after designs were already saved. They read as absent
 * from older JSON and are left out when unset, so stored sources keep
 * loading and re-serialize without new null keys. Keyed by Rust struct name, listing the
 * TypeScript property names. Add new late optional fields here, never by hand
 * in definition.rs.
 */
const SERDE_DEFAULT_FIELDS: Record<string, string[]> = {
  ShipDefinition: ['maneuvering'],
  ConstructionData: ['finish', 'paint'],
  ConstructionPrimitive: ['tilt'],
  ConstructionCustomHull: ['paintBands'],
  ConstructionEquipmentPath: ['access'],
  ConstructionEquipmentPart: ['wallSizing', 'riggingSurface'],
  ConstructionEquipmentWall: ['turnDeg'],
};
/** Rust types the TypeScript shape cannot express. Keyed `Struct.property`. */
const TYPE_OVERRIDES: Record<string, string> = {
  // Closed cells are immutable once compiled; hydrostatics/collision clones share their face storage.
  'ConvexVolume.faces': 'std::sync::Arc<[ConvexVolumeFacesItem]>',
};
const RUST_KEYWORDS = ['type','ref','match','mod','loop','move','where','in','self','use','fn'];
const source = 'src/ships/blueprint.ts';
const program = ts.createProgram([source], { strict: true, target: ts.ScriptTarget.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext });
const checker = program.getTypeChecker();
const file = program.getSourceFile(source)!;
const declaration = file.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'ShipDefinition')!;
const root = checker.getTypeAtLocation(declaration);
const definitions: string[] = [];
const usedTableEntries = new Set<string>();
const assigned = new Map<ts.Type, string>();
const names = new Set<string>();
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function rustType(original: ts.Type, hint: string): string {
  let type = original;
  if (type.isUnion()) {
    const members = type.types.filter(t => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
    if (members.length === 1) return rustType(members[0], hint);
    if (members.every(t => !!(t.flags & ts.TypeFlags.StringLike))) return 'String';
    if (members.every(t => !!(t.flags & ts.TypeFlags.NumberLike))) return 'f64';
    if (members.every(t => !!(t.flags & ts.TypeFlags.BooleanLike))) return 'bool';
    throw new Error(`Unsupported union ${hint}: ${checker.typeToString(type)}`);
  }
  if (type.flags & ts.TypeFlags.StringLike) return 'String';
  if (type.flags & ts.TypeFlags.NumberLike) return 'f64';
  if (type.flags & ts.TypeFlags.BooleanLike) return 'bool';
  if (checker.isTupleType(type)) {
    const types = checker.getTypeArguments(type as ts.TypeReference).map((t,i) => rustType(t, hint + i));
    if (new Set(types).size === 1) return `[${types[0]}; ${types.length}]`;
    return `(${types.join(', ')})`;
  }
  if (checker.isArrayType(type)) return `Vec<${rustType(checker.getTypeArguments(type as ts.TypeReference)[0], hint + 'Item')}>`;
  const prior = assigned.get(type);
  if (prior) return prior;
  const symbolName = type.aliasSymbol?.name ?? type.symbol?.name;
  let name = symbolName && !symbolName.startsWith('__') && !['Omit','Partial','Pick'].includes(symbolName) ? symbolName : hint;
  if (name === 'ShipDefinitionMountsItem') name = 'MountDefinition';
  if (name === 'ShipDefinitionTorpedoTubesItem') name = 'TubeDefinition';
  if (name === 'ShipDefinitionDepthChargeLaunchersItem') name = 'ChargeDefinition';
  if (names.has(name)) name = hint;
  if (names.has(name)) throw new Error(`Duplicate name ${name}`);
  names.add(name); assigned.set(type, name);
  const fields = checker.getPropertiesOfType(type).map(property => {
    const location = property.valueDeclaration ?? property.declarations?.[0];
    if (!location) throw new Error(`No declaration ${name}.${property.name}`);
    const field = snake(property.name);
    const optional = !!(property.flags & ts.SymbolFlags.Optional);
    const generatedType = rustType(checker.getTypeOfSymbolAtLocation(property, location), name + pascal(property.name));
    const key = `${name}.${property.name}`;
    const fieldType = TYPE_OVERRIDES[key] ?? generatedType;
    const identifier = RUST_KEYWORDS.includes(field) ? 'r#' + field : field;
    const late = SERDE_DEFAULT_FIELDS[name]?.includes(property.name) ?? false;
    if (late && !optional) throw new Error(`${key} is listed in SERDE_DEFAULT_FIELDS but is not optional`);
    if (late || key in TYPE_OVERRIDES) usedTableEntries.add(key);
    const defaults = late ? ', default, skip_serializing_if = "Option::is_none"' : '';
    return `    #[serde(rename = "${property.name}"${defaults})]\n    pub ${identifier}: ${optional ? `Option<${fieldType}>` : fieldType},`;
  });
  definitions.push(`#[derive(Clone, Debug, Default, Serialize, Deserialize)]\npub struct ${name} {\n${fields.join('\n')}\n}\n`);
  return name;
}
rustType(root, 'ShipDefinition');
// Additional source/result roots share the same type graph and generator. No object unions.
for (const name of ['ConstructionSource', 'ConstructionResult', 'ConstructionCatalog', 'ConstructionSuggestion']) {
  const node = file.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === name);
  if (!node) throw new Error(`Missing schema root ${name}`);
  rustType(checker.getTypeAtLocation(node), name);
}
for (const key of [...Object.entries(SERDE_DEFAULT_FIELDS).flatMap(([name, fields]) => fields.map(field => `${name}.${field}`)), ...Object.keys(TYPE_OVERRIDES)]) {
  if (!usedTableEntries.has(key)) throw new Error(`${key} is configured in the generator but no longer exists in ${source}`);
}
const HEADER = '// Generated by scripts/multiplayer/generate-rust-definitions.ts from src/ships/blueprint.ts.\n// Regenerate with `bun run multiplayer:definitions`; never edit by hand. Serde attributes and type\n// overrides live in the tables at the top of the generator. A bun test fails when this file drifts.\nuse serde::{Deserialize, Serialize};\npub type Vec3 = [f64; 3];\n\n';

/** The exact text definition.rs must contain: generated, then formatted by rustfmt. */
export async function renderDefinitions(): Promise<string> {
  const format = Bun.spawn([rustTool('rustfmt'), '--edition', '2024', '--emit', 'stdout'], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' });
  format.stdin.write(HEADER + definitions.join('\n'));
  format.stdin.end();
  const [text, code] = await Promise.all([new Response(format.stdout).text(), format.exited]);
  if (code) throw new Error('Rust definition formatting failed.');
  return text;
}

if (import.meta.main) {
  await Bun.write(DEFINITION_PATH, await renderDefinitions());
  console.log(`Generated ${definitions.length} Rust definition types.`);
}
