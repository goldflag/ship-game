import ts from 'typescript';
import { readFileSync } from 'node:fs';
import type { Field, ObjectSpec, Spec } from './constructionCommandSchema';

/** Test support: reads the declared TypeScript source types syntactically, so a test can prove the
 * command specs and patch tables still cover every declared field. Not imported by the game. */
export interface TypeField {
  optional: boolean;
  fields?: Record<string, TypeField>;
  items?: TypeField;
  literals?: (string | number)[];
}
export function readTypes(paths: string[]) {
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  for (const path of paths)
    ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true).forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) declarations.set(node.name.text, node);
    });
  const members = (list: ts.NodeArray<ts.TypeElement>): Record<string, TypeField> =>
    Object.fromEntries(
      list.filter(ts.isPropertySignature).map((member) => [(member.name as ts.Identifier).text, { ...resolve(member.type!), optional: !!member.questionToken }]),
    );
  const named = (name: string): Record<string, TypeField> | undefined => {
    const node = declarations.get(name);
    if (!node) return undefined;
    if (ts.isTypeAliasDeclaration(node)) return resolve(node.type).fields;
    const inherited = (node.heritageClauses ?? []).flatMap((clause) => clause.types).map((parent) => resolve(parent as unknown as ts.TypeNode).fields ?? {});
    return Object.assign({}, ...inherited, members(node.members));
  };
  const names = (node: ts.TypeNode): string[] =>
    ts.isUnionTypeNode(node) ? node.types.flatMap(names) : ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ? [node.literal.text] : [];
  function resolve(node: ts.TypeNode): Omit<TypeField, 'optional'> {
    if (ts.isParenthesizedTypeNode(node)) return resolve(node.type);
    if (ts.isTypeLiteralNode(node)) return { fields: members(node.members) };
    if (ts.isArrayTypeNode(node)) return { items: { ...resolve(node.elementType), optional: false } };
    if (ts.isLiteralTypeNode(node)) {
      if (ts.isStringLiteral(node.literal)) return { literals: [node.literal.text] };
      if (ts.isNumericLiteral(node.literal)) return { literals: [Number(node.literal.text)] };
    }
    if (ts.isUnionTypeNode(node)) {
      const parts = node.types.map(resolve);
      return parts.every((part) => part.literals) ? { literals: parts.flatMap((part) => part.literals!) } : {};
    }
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      const name = (ts.isTypeReferenceNode(node) ? node.typeName : node.expression).getText(),
        args = node.typeArguments ?? [];
      if (name === 'NonNullable') return resolve(args[0]);
      if (name === 'Partial') {
        const inner = resolve(args[0]).fields;
        return inner ? { fields: Object.fromEntries(Object.entries(inner).map(([key, field]) => [key, { ...field, optional: true }])) } : {};
      }
      if (name === 'Pick' || name === 'Omit') {
        const inner = resolve(args[0]).fields,
          keys = names(args[1]);
        return inner ? { fields: Object.fromEntries(Object.entries(inner).filter(([key]) => keys.includes(key) === (name === 'Pick'))) } : {};
      }
      const declaration = declarations.get(name);
      if (declaration && ts.isTypeAliasDeclaration(declaration)) return resolve(declaration.type);
      const fields = named(name);
      return fields ? { fields } : {};
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      const { optional: _, ...member } = resolve(node.objectType).fields?.[names(node.indexType)[0]] ?? { optional: false };
      return member;
    }
    return {};
  }
  return {
    fields: (name: string) => named(name) ?? {},
    /** Members of a union of object literals keyed by a string-literal discriminant. */
    union(name: string, discriminant: string): Record<string, Record<string, TypeField>> {
      const node = declarations.get(name);
      if (!node || !ts.isTypeAliasDeclaration(node) || !ts.isUnionTypeNode(node.type)) throw new Error(name + ' is not a union.');
      return Object.fromEntries(
        node.type.types.map((member) => {
          const { [discriminant]: tag, ...rest } = resolve(member).fields ?? {};
          if (tag?.literals?.length !== 1) throw new Error(`A ${name} member lacks a literal ${discriminant}.`);
          return [String(tag.literals[0]), rest];
        }),
      );
    },
  };
}

/** Differences between a spec and the declared type, as readable lines; empty when they agree. */
export function specDrift(spec: Record<string, Field>, declared: Record<string, TypeField>, path = ''): string[] {
  const at = (key: string) => (path ? path + '.' + key : key),
    drift: string[] = [];
  for (const key of Object.keys(declared)) if (!Object.hasOwn(spec, key)) drift.push(`${at(key)} is declared but has no spec`);
  for (const [key, field] of Object.entries(spec)) {
    const type = declared[key];
    if (!type) drift.push(`${at(key)} has a spec but is not declared`);
    else {
      if (!!field.optional !== type.optional) drift.push(`${at(key)} is ${type.optional ? 'optional' : 'required'} in the type`);
      drift.push(...valueDrift(field, type, at(key)));
    }
  }
  return drift;
}
function valueDrift(spec: Spec, type: Omit<TypeField, 'optional'>, path: string): string[] {
  if (spec.type === 'object') return type.fields ? specDrift(spec.fields, type.fields, path) : [];
  if (spec.type === 'array') return type.items ? valueDrift(spec.items, type.items, path + '[]') : [];
  if ((spec.type === 'string' || spec.type === 'number') && (spec.enum || type.literals)) {
    const a = [...(spec.enum ?? [])].map(String).sort().join('|'),
      b = [...(type.literals ?? [])].map(String).sort().join('|');
    if (a !== b) return [`${path} allows ${a || 'anything'} in the spec but ${b || 'anything'} in the type`];
  }
  return [];
}
export const objectSpecDrift = (spec: ObjectSpec, declared: Record<string, TypeField>) => specDrift(spec.fields, declared, spec.name);
