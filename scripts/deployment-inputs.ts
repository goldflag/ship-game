import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
// Exactly the runtime inputs shipped by deploy-hermes.sh. Include web output:
// the simulation identity alone does not identify auth or transport changes.
const roots = ['Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','bun.lock',
  'crates','assets/gameplay','assets/parts/construction/hull_shapes.rs',
  'public/models/components/catalogs','.build/naval-content/manifest.json',
  'compose.yml','.dockerignore','deploy','services','dist','src/generated/naval-version.json'];
export async function releaseDigest() {
  const files:string[]=[];
  async function visit(path:string) {
    if((await stat(path)).isDirectory()) for(const child of await readdir(path)) await visit(path+'/'+child);
    else files.push(path);
  }
  for(const root of roots) await visit(root);
  const hash=createHash('sha256');
  for(const file of files.sort()) { const bytes=await readFile(file);hash.update(file+'\0'+bytes.length+'\0').update(bytes); }
  return hash.digest('hex');
}
if(import.meta.main) console.log(await releaseDigest());
