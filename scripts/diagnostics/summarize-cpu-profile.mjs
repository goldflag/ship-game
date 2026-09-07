import { readFile } from 'node:fs/promises';
const profile = JSON.parse(await readFile(process.argv[2], 'utf8'));
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
const self = new Map(), total = new Map(), parents = new Map();
for (const n of nodes.values()) for (const id of n.children ?? []) parents.set(id, n.id);
const key = id => { const f = nodes.get(id).callFrame; return `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/(src|node_modules|vendor)\//, '$1/').split('?')[0]}:${f.lineNumber + 1}`; };
for (let i = 0; i < profile.samples.length; i++) {
  const sample = profile.samples[i], ms = profile.timeDeltas[i] / 1000;
  self.set(key(sample), (self.get(key(sample)) ?? 0) + ms);
  const seen = new Set();
  for (let id = sample; id; id = parents.get(id)) { const name = key(id); if (seen.has(name)) continue; seen.add(name); total.set(name, (total.get(name) ?? 0) + ms); }
}
for (const [name, rows] of [['Self', self], ['Total', total]]) {
  console.log(name);
  console.log([...rows].sort((a,b) => b[1] - a[1]).slice(0, 35).map(([k,ms]) => `${ms.toFixed(1)} ms ${k}`).join('\n'));
}
