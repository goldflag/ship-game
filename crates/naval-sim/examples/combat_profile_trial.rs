//! Scripted mechanics comparison; fixtures stay in the existing definition model.
use naval_sim::{
    breaches::add_breach,
    collisions::resolve_ship_collisions,
    construction_geometry as cg,
    contacts::{ContactGeometry, ContactKind, contact_armor, ship_contacts},
    damage::Combatant,
    definition::*,
    flooding::update_flooding,
    geometry::*,
    hydrostatics::HullHydrostatics,
    impact::resolve_ship_contact,
    machinery::system_health,
    motion::HelmCommand,
    rules::TeamId,
    shell::Shell,
    vessel::{CompiledShip, Vessel},
};
use std::{sync::Arc, time::Instant};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let d: ShipDefinition = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let h = HullHydrostatics::new(&d.hull, None);
    let mut scenarios = vec![];
    for mode in [
        "dry",
        "partial",
        "heel",
        "overturn",
        "capsize-fixture",
        "flooded",
        "breach",
        "progressive",
    ] {
        // A deliberately top-heavy calibration verifies the loss transition;
        // it is not a claim that an unmodified Hipper must remain capsized.
        let raised = if mode == "capsize-fixture" {
            let mut copy = d.clone();
            copy.stability.as_mut().unwrap().dry_center_of_gravity[1] = 20.;
            copy.loading.as_mut().unwrap().center_of_gravity[1] = 20.;
            Some(copy)
        } else {
            None
        };
        let d = raised.as_ref().unwrap_or(&d);
        let mut a = Combatant::new("trial", d);
        let initial = serde_json::to_value(&a).unwrap();
        if mode == "partial" || mode == "heel" {
            let i = d
                .compartments
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.capacity_m3.total_cmp(&b.capacity_m3))
                .unwrap()
                .0;
            a.damage.compartments[i].water_m3 = d.compartments[i].capacity_m3 * 0.3;
        }
        if mode == "heel" {
            a.motion.roll = radians(90.);
        }
        if mode == "overturn" {
            a.motion.roll = radians(170.);
            for (c, r) in a.damage.compartments.iter_mut().zip(&d.compartments) {
                c.water_m3 = r.capacity_m3 * 0.5;
            }
        }
        if mode == "capsize-fixture" {
            a.motion.roll = radians(170.);
        }
        if mode == "progressive" {
            let (i, edge) = d
                .connections
                .iter()
                .enumerate()
                .filter(|(_, c)| {
                    let capacity = |id: &str| {
                        d.compartments
                            .iter()
                            .find(|r| r.id == id)
                            .unwrap()
                            .capacity_m3
                    };
                    capacity(&c.from_id) > 10. && capacity(&c.to_id) > 10.
                })
                .max_by(|(_, a), (_, b)| a.area_m2.total_cmp(&b.area_m2))
                .unwrap();
            let from = d
                .compartments
                .iter()
                .enumerate()
                .filter(|(_, r)| r.id == edge.from_id || r.id == edge.to_id)
                .max_by(|(_, a), (_, b)| a.center[1].total_cmp(&b.center[1]))
                .unwrap()
                .0;
            a.damage.compartments[from].water_m3 = d.compartments[from].capacity_m3 * 0.5;
            a.damage.connections[i].state = "damaged".into();
            a.damage.connections[i].damage_area_m2 = 0.5;
        }
        if mode == "flooded" {
            for (c, r) in a.damage.compartments.iter_mut().zip(&d.compartments) {
                c.water_m3 = r.capacity_m3 * 0.95;
            }
        }
        if mode == "breach" {
            let p = [-9., -4., -30.];
            let i = d
                .compartments
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    cg::room_distance(a, p).total_cmp(&cg::room_distance(b, p))
                })
                .unwrap()
                .0;
            add_breach(&mut a.damage.compartments[i], p, 2., -1, None, None, false);
        }
        let start = Instant::now();
        let mut milestones = vec![];
        let movement=naval_sim::maneuvering::Maneuvering::new(d);
        for tick in 0..if mode == "capsize-fixture" { 1200 } else { 600 } {
            naval_sim::maneuvering::step(
                &mut a, d, &movement,
                HelmCommand {
                    throttle: 1.,
                    rudder: 0.5,
                    ..Default::default()
                },
                None,
            );
            update_flooding(&mut a, d, &h, 1. / 60., 0.5, None, None);
            if tick % 60 == 59 {
                milestones.push(serde_json::json!({"second":(tick+1)/60,"waterM3":a.damage.compartments.iter().map(|c|c.water_m3).sum::<f64>(),"wetRooms":a.damage.compartments.iter().filter(|c|c.water_m3>0.001).count(),"position":[a.motion.x,a.motion.y,a.motion.z],"roll":a.motion.roll,"pitch":a.motion.pitch,"heading":a.motion.heading,"speed":a.motion.speed,"sunk":a.damage.sunk,"status":a.damage.stability.status,"cause":a.damage.defeat_cause,"engine":system_health(&a,d,"engine",None),"steering":system_health(&a,d,"steering",None)}));
            }
        }
        let reset = Combatant::new("trial", d);
        assert_eq!(initial, serde_json::to_value(&reset).unwrap());
        scenarios.push(serde_json::json!({"mode":mode,"runtimeMs":start.elapsed().as_secs_f64()*1000.,"resetExact":true,"milestones":milestones}));
        eprintln!("{mode} complete");
    }
    let compiled = Arc::new(CompiledShip::new(Arc::new(d.clone()), None).unwrap());
    let mut collisions = vec![];
    for (x, z, heading, roll) in [
        (23., 0., 0., 0.),
        (21., 0., 0., 0.),
        (0., 203., 0., 0.),
        (21., 0., 0., 0.6),
    ] {
        let a = Vessel::new("a", TeamId::A, compiled.clone());
        let mut b = Vessel::new("b", TeamId::B, compiled.clone());
        b.motion.x = x;
        b.motion.z = z;
        b.motion.heading = heading;
        b.motion.roll = roll;
        b.motion.sway_speed = -3.;
        let mut actors = vec![a, b];
        let start = Instant::now();
        let events = resolve_ship_collisions(&mut actors);
        collisions.push(serde_json::json!({"x":x,"z":z,"roll":roll,"ms":start.elapsed().as_secs_f64()*1000.,"events":events,"positions":actors.iter().map(|a|[a.motion.x,a.motion.y,a.motion.z]).collect::<Vec<_>>()}));
    }
    let geometry = ContactGeometry::new(&d).unwrap();
    let mut shots = vec![];
    for z in [-54., 0., 54.] {
        for y in [-4., 0., 5.] {
            for pen in [30., 100., 300.] {
                let mut a = Combatant::new("target", &d);
                let mut shell = Shell {
                    penetration_mm: pen,
                    caliber_m: 0.203,
                    damage: 100.,
                    velocity: [700., 0., 0.],
                    ..Default::default()
                };
                let hit = ship_contacts(&shell, [-30., y, z], [30., y, z], &a, &d, &geometry)
                    .into_iter()
                    .find(|h| h.kind == ContactKind::Armor);
                let result=hit.map(|h|{let thickness=contact_armor(&d,&h).thickness_mm;let (stopped,event)=resolve_ship_contact(&mut shell,&h,&mut a,&d,Some([1.,0.,0.]));serde_json::json!({"point":h.point,"thickness":thickness,"stopped":stopped,"penetrationAfter":shell.penetration_mm,"impact":event.impact})});
                shots
                    .push(serde_json::json!({"z":z,"y":y,"penetrationBefore":pen,"result":result}));
            }
        }
    }
    println!(
        "{}",
        serde_json::json!({"scenarios":scenarios,"collisions":collisions,"shots":shots})
    );
}
