use naval_sim::{construction, construction_geometry as cg, definition::*};
use serde_json::json;

fn primitive(kind: &str) -> ConstructionPrimitive {
    serde_json::from_value(json!({"id":"hull", "kind":kind, "size":[4,2,6], "position":[0,0,0], "rotationDeg":0})).unwrap()
}
fn tilt(pitch: f64, roll: f64) -> ConstructionPrimitiveTilt {
    ConstructionPrimitiveTilt { version: 1., pitch_deg: pitch, roll_deg: roll }
}
#[test]
fn native_shape_paths_rotate_rigidly_without_baking_the_source() {
    let mut primitives: Vec<_> = ["box", "wedge", "corner", "inverse-corner", "cylinder", "hollow-cube", "hemisphere-shell", "vertex", "balcony", "ballast"].iter().map(|k| primitive(k)).collect();
    let balcony = primitives.iter_mut().find(|p| p.kind == "balcony").unwrap();
    balcony.size[1] = 0.08;
    balcony.balcony = Some(serde_json::from_value(json!({"version":1,"heightM":1.1,"wallThicknessM":0.06,"points":[{"id":"a","x":-0.5,"z":-0.5,"edge":"wall"},{"id":"b","x":0.5,"z":-0.5,"edge":"wall"},{"id":"c","x":0.5,"z":0.5,"edge":"wall"},{"id":"d","x":-0.5,"z":0.5,"edge":"open"}]})).unwrap());
    let mut rounded = primitive("vertex");
    rounded.shaping = Some(serde_json::from_value(json!({"version":1,"edges":[0,1,2,3],"radius":0.15,"style":"round"})).unwrap());
    primitives.push(rounded);
    let mut hull = primitive("custom-hull");
    hull.custom_hull = Some(serde_json::from_value(json!({"version":1,"rake":0,"bulb":0,"stations": ([0.,0.3,0.7,1.].iter().enumerate().map(|(i,t)|json!({"id":format!("s{i}"),"t":t,"points":[{"x":-1,"y":0.5},{"x":-1,"y":-0.4},{"x":0,"y":-0.5},{"x":1,"y":-0.4},{"x":1,"y":0.5}]})).collect::<Vec<_>>())})).unwrap());
    primitives.push(hull);
    let mut mesh = primitive("vertex");
    let vertices = json!([[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0,0.5,-0.5],[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0,0.5,0.5]]);
    mesh.mesh = Some(serde_json::from_value(json!({"version":1,"label":"Prism","family":"prism","vertices":vertices,"reference":vertices,"rings":[[0,1,2],[3,4,5]],"faces":[{"id":"bow","name":"bow","corners":[0,2,1]},{"id":"stern","name":"stern","corners":[3,4,5]},{"id":"bottom","name":"bottom","corners":[0,1,4,3]},{"id":"s1","name":"slope","corners":[1,2,5,4]},{"id":"s2","name":"slope","corners":[2,0,3,5]}]})).unwrap());
    primitives.push(mesh);
    for p in primitives {
        let before = construction::primitive_cells(&p).unwrap();
        for (pitch, roll) in [(90.,0.),(0.,90.)] {
            let mut turned = p.clone(); turned.tilt = Some(tilt(pitch,roll));
            let after = construction::primitive_cells(&turned).unwrap();
            assert!((cg::total(&before).volume-cg::total(&after).volume).abs()<1e-6, "{} volume",p.kind);
            let expected: Vec<Vec3> = before.iter().flat_map(|c| c.faces.iter()).flat_map(|f| &f.vertices).map(|v| if pitch!=0. {[v[0],-v[2],v[1]]} else {[-v[1],v[0],v[2]]}).collect();
            for v in after.iter().flat_map(|c| c.faces.iter()).flat_map(|f| &f.vertices) {
                assert!(expected.iter().any(|p| (0..3).all(|k| (v[k]-p[k]).abs()<1e-7)), "{} rotated point {v:?}",p.kind);
            }
        }
    }
}
#[test]
fn saved_orientation_compiles_with_face_assignments_and_rejects_bad_tilt() {
    let catalog = ConstructionCatalog { schema_version:1.,revision:"test".into(), weapons:PartCatalog {schema_version:1.,..Default::default()},..Default::default() };
    let mut source: ConstructionSource = serde_json::from_value(json!({"schemaVersion":1,"id":"turn","name":"Turn","coordinates":"meters-y-up-bow-negative-z","revision":"one","construction":{"version":1,"catalogRevision":"test","defaultThicknessMm":10,"primitives":[primitive("box")],"surfaces":[{"primitiveId":"hull","face":"top","thicknessMm":25,"material":"armor-steel","paint":"deck-gray"}],"equipment":[],"boundaries":[],"loads":[]}})).unwrap();
    assert!(serde_json::to_value(&source).unwrap()["construction"]["primitives"][0].get("tilt").is_none(), "Legacy sources omit absent tilt");
    source.construction.primitives[0].tilt = Some(tilt(90.,0.));
    let restored: ConstructionSource = serde_json::from_str(&serde_json::to_string(&source).unwrap()).unwrap();
    let result = construction::compile(&restored,&catalog);
    assert!(result.definition.is_some(), "{:?}",result.diagnostics);
    let top: Vec<_> = result.surfaces.iter().filter(|s| s.face=="top").collect();
    assert!(!top.is_empty());
    assert!(top.iter().all(|s| s.paint=="deck-gray" && s.thickness_mm==25. && s.normal[2]>0.999));
    source.construction.primitives[0].rotation_deg=37.5;
    source.construction.primitives[0].tilt=Some(tilt(24.5,-15.));
    assert!(construction::compile(&source,&catalog).definition.is_some());
    for invalid in [ConstructionPrimitiveTilt {version:2.,..tilt(0.,0.)},tilt(3601.,0.),tilt(0.,f64::NAN)] {
        source.construction.primitives[0].tilt=Some(invalid);
        assert!(construction::compile(&source,&catalog).definition.is_none());
    }
}
