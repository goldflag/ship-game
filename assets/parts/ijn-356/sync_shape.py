"""Run with background Blender to synchronize the original catalog shell."""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(root/'scripts/ships'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry import gunhouse_shape
path=root/'assets/parts/guns.json'
catalog=json.loads(path.read_text())
part=next(p for p in catalog['parts'] if p['id']=='type41-356-kongo-twin')
part['gunhouseMesh']=gunhouse_shape()
part['gunhouseSize'][0]=11.56
path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
print('Synchronized original Kongō gunhouse shell and apertures')
