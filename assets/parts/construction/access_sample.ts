/** Blender's standalone sample uses the same original recipe as the editor. */
import { accessDefaults, accessLayout, accessMemberAxes, type AccessKind } from './access_geometry';
const kind = process.argv[2] as AccessKind;
const layout = accessLayout(kind, [[0,0,0],[0,3,kind === 'inclined-ladder' ? -2.5 : 0]], accessDefaults(kind))!;
console.log(JSON.stringify(layout.members.map(m => ({ ...m, axes: accessMemberAxes(m) }))));
