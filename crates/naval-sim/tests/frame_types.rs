//! The frame's element shapes are declared once, on the simulation types, and
//! generated for the client. This walks real frames against those declarations:
//! every key a frame carries is declared, every required key travels, every
//! string a declared word set names parses, so a field the filter drops or a
//! word the emitter adds fails here rather than at a renderer branch.
use naval_sim::{
    aviation,
    battle::{Battle, BattleSetup, Event},
    bots,
    catalog::Catalog,
    damage, damage_control, depth_charges, frame_vocabulary, impact, motion, navigation, records,
    rules, shell, stability, submarine, torpedoes, vessel, weapons,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};
use ts_rs::TS;

enum Decl {
    /// Field name, optional, TypeScript type expression.
    Object(Vec<(String, bool, String)>),
    Words(Vec<String>),
    Opaque,
}
/// Split at depth-zero commas (or bars), honouring every bracket kind.
fn split(body: &str, at: char) -> Vec<String> {
    let mut parts = vec![];
    let mut depth = 0i32;
    let mut current = String::new();
    let mut quoted = false;
    for c in body.chars() {
        match c {
            '"' => quoted = !quoted,
            '{' | '[' | '<' | '(' if !quoted => depth += 1,
            '}' | ']' | '>' | ')' if !quoted => depth -= 1,
            _ => {}
        }
        if c == at && depth == 0 && !quoted {
            parts.push(current.trim().to_string());
            current.clear();
        } else {
            current.push(c);
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}
fn parse(decl: &str) -> Decl {
    // Doc comments travel into the declaration; they are not fields.
    let mut text = String::new();
    let mut rest = decl;
    while let Some(start) = rest.find("/**") {
        text.push_str(&rest[..start]);
        let end = rest[start..].find("*/").expect("closed doc comment") + start + 2;
        rest = &rest[end..];
    }
    text.push_str(rest);
    let rhs = text.split_once('=').expect("type alias").1.trim();
    let rhs = rhs.strip_suffix(';').unwrap_or(rhs).trim();
    if rhs.starts_with('{') && rhs.ends_with('}') && !rhs.contains("} | {") {
        let body = &rhs[1..rhs.len() - 1];
        Decl::Object(
            split(body, ',')
                .into_iter()
                .map(|field| {
                    let (name, ty) = field.split_once(':').expect("field");
                    let optional = name.ends_with('?');
                    (
                        name.trim_end_matches('?').trim().to_string(),
                        optional,
                        ty.trim().to_string(),
                    )
                })
                .collect(),
        )
    } else if rhs.starts_with('"') {
        Decl::Words(
            split(rhs, '|')
                .into_iter()
                .map(|w| w.trim_matches('"').to_string())
                .collect(),
        )
    } else {
        Decl::Opaque
    }
}
struct Declarations(HashMap<String, Decl>);
impl Declarations {
    fn add<T: TS>(&mut self) {
        let cfg = ts_rs::Config::default();
        self.0.insert(T::name(&cfg), parse(&T::decl(&cfg)));
    }
    /// The frame is checked against the declared type expression at `path`.
    fn check(&self, expr: &str, value: &Value, path: &str) {
        let expr = expr.trim();
        if let Some(inner) = expr.strip_suffix(" | null") {
            if value.is_null() {
                return;
            }
            return self.check(inner, value, path);
        }
        if let Some(inner) = expr
            .strip_prefix("Array<")
            .and_then(|e| e.strip_suffix('>'))
        {
            let items = value
                .as_array()
                .unwrap_or_else(|| panic!("{path}: expected an array"));
            for (i, item) in items.iter().enumerate() {
                self.check(inner, item, &format!("{path}[{i}]"));
            }
            return;
        }
        if let Some(inner) = expr
            .strip_prefix("{ [key in string]: ")
            .and_then(|e| e.strip_suffix(" }"))
        {
            let map = value
                .as_object()
                .unwrap_or_else(|| panic!("{path}: expected a map"));
            for (key, item) in map {
                self.check(inner, item, &format!("{path}.{key}"));
            }
            return;
        }
        match expr {
            "number" => assert!(value.is_number(), "{path}: expected a number, got {value}"),
            "string" => assert!(value.is_string(), "{path}: expected a string, got {value}"),
            "boolean" => assert!(
                value.is_boolean(),
                "{path}: expected a boolean, got {value}"
            ),
            "[]" => assert_eq!(value, &json!([]), "{path}: declared always empty"),
            e if e.starts_with('[') => assert!(value.is_array(), "{path}: expected a tuple"),
            e if e.contains("import(") => {}
            name => match self.0.get(name) {
                Some(Decl::Object(fields)) => {
                    let object = value
                        .as_object()
                        .unwrap_or_else(|| panic!("{path}: expected {name}, got {value}"));
                    for key in object.keys() {
                        assert!(
                            fields.iter().any(|(f, ..)| f == key),
                            "{path}: `{key}` travels but {name} does not declare it"
                        );
                    }
                    for (field, optional, ty) in fields {
                        match object.get(field) {
                            Some(v) => self.check(ty, v, &format!("{path}.{field}")),
                            None => {
                                assert!(*optional, "{path}: {name}.{field} is required but absent")
                            }
                        }
                    }
                }
                Some(Decl::Words(words)) => {
                    let word = value
                        .as_str()
                        .unwrap_or_else(|| panic!("{path}: expected one of {name}, got {value}"));
                    assert!(
                        words.iter().any(|w| w == word),
                        "{path}: `{word}` is not a declared {name}"
                    );
                }
                Some(Decl::Opaque) => {}
                None => panic!("{path}: {name} is not registered with this test"),
            },
        }
    }
}
fn declarations() -> Declarations {
    let mut d = Declarations(HashMap::new());
    d.add::<vessel::Vessel>();
    d.add::<vessel::Controller>();
    d.add::<rules::TeamId>();
    d.add::<bots::AiLevel>();
    d.add::<motion::HelmCommand>();
    d.add::<motion::ShipState>();
    d.add::<navigation::NavigationState>();
    d.add::<navigation::Movement>();
    d.add::<navigation::NavigationStatus>();
    d.add::<navigation::FormationReport>();
    d.add::<navigation::Straggler>();
    d.add::<navigation::Formation>();
    d.add::<damage::DamageState>();
    d.add::<damage::RegionState>();
    d.add::<damage::ModuleState>();
    d.add::<damage::CompartmentState>();
    d.add::<damage::ConnectionState>();
    d.add::<damage::Breach>();
    d.add::<damage_control::ControlState>();
    d.add::<damage_control::ControlJob>();
    d.add::<damage_control::JobKind>();
    d.add::<damage_control::FireState>();
    d.add::<damage_control::FireTrend>();
    d.add::<stability::StabilityState>();
    d.add::<weapons::MountState>();
    d.add::<weapons::MountStatus>();
    d.add::<weapons::Ammunition>();
    d.add::<weapons::AimCache>();
    d.add::<submarine::SubmarineState>();
    d.add::<torpedoes::TubeState>();
    d.add::<torpedoes::Torpedo>();
    d.add::<depth_charges::DepthChargeLauncherState>();
    d.add::<depth_charges::DepthCharge>();
    d.add::<aviation::CarrierWing>();
    d.add::<aviation::AirWingState>();
    d.add::<aviation::AirFlight>();
    d.add::<aviation::AirOrder>();
    d.add::<aviation::Aircraft>();
    d.add::<aviation::AircraftBehavior>();
    d.add::<aviation::AirWreck>();
    d.add::<aviation::AirRelease>();
    d.add::<aviation::SearchProgress>();
    d.add::<aviation::SearchSample>();
    d.add::<aviation::FlightControls>();
    d.add::<aviation::FlightAttitude>();
    d.add::<naval_sim::aviation::CarrierRecovery>();
    d.add::<naval_sim::aviation::EndurancePolicy>();
    d.add::<aviation::DeckStatus>();
    d.add::<aviation::DeckRequest>();
    d.add::<aviation::DeckAction>();
    d.add::<aviation::DeckPolicy>();
    d.add::<shell::Shell>();
    d.add::<shell::LocalDamageEvidence>();
    d.add::<Event>();
    d.add::<impact::ImpactRecord>();
    d.add::<impact::SurfaceImpact>();
    d.add::<impact::ShellEffect>();
    d.add::<impact::AircraftEffect>();
    d.add::<impact::AirburstEffect>();
    d.add::<impact::TorpedoEffect>();
    d.add::<impact::DepthChargeEffect>();
    d.add::<impact::BreachAssignment>();
    d.add::<records::Records>();
    d.add::<records::VesselScore>();
    d.add::<records::DamageLogEntry>();
    d.add::<records::ShellHistory>();
    d.add::<records::AfterAction>();
    d.add::<records::ShipReport>();
    d.add::<records::HitReport>();
    d.add::<records::HitPlate>();
    d.add::<records::HitModule>();
    d.add::<records::DamageSample>();
    d.add::<records::HitWeapon>();
    d.add::<records::HitOutcome>();
    d.add::<frame_vocabulary::EventKind>();
    d.add::<frame_vocabulary::DefeatCause>();
    d.add::<frame_vocabulary::VesselStatus>();
    d.add::<frame_vocabulary::ConnectionStatus>();
    d.add::<frame_vocabulary::TubeStatus>();
    d.add::<frame_vocabulary::LauncherStatus>();
    d.add::<frame_vocabulary::FlightPhase>();
    d.add::<frame_vocabulary::ShellType>();
    d.add::<frame_vocabulary::ImpactKind>();
    d.add::<frame_vocabulary::FuzeState>();
    d.add::<frame_vocabulary::ImpactOutcome>();
    d.add::<frame_vocabulary::SurfaceOutcome>();
    d.add::<frame_vocabulary::ShellOutcome>();
    d
}
/// The frame's eight element collections, as the client types them.
fn check_frame(d: &Declarations, frame: &Value, label: &str) {
    for (key, ty) in [
        ("actors", "Array<Vessel>"),
        ("wings", "Array<CarrierWing>"),
        ("shells", "Array<Shell>"),
        ("torpedoes", "Array<Torpedo>"),
        ("depthCharges", "Array<DepthCharge>"),
        ("releases", "Array<AirRelease>"),
        ("events", "Array<Event>"),
        ("records", "Records"),
    ] {
        d.check(ty, &frame[key], &format!("{label}.{key}"));
    }
    if let Some(report) = frame.get("afterAction") {
        d.check("AfterAction", report, &format!("{label}.afterAction"));
    }
}
/// What a receiver holds: the frame as the codec normalizes it, null
/// optionals dropped (with its one declared exception).
fn received<T: serde::Serialize>(frame: &T) -> Value {
    serde_json::from_str(
        &naval_sim::frame_delta::FrameDelta::complete(frame).expect("complete frame"),
    )
    .expect("frame json")
}
fn catalog() -> Arc<Catalog> {
    Catalog::installed()
}
fn compile(
    catalog: &Catalog,
    ids: impl Iterator<Item = String>,
) -> BTreeMap<String, Arc<vessel::CompiledShip>> {
    let mut compiled = BTreeMap::new();
    for id in ids {
        compiled.entry(id.clone()).or_insert_with(|| {
            Arc::new(
                vessel::CompiledShip::new(
                    catalog.definitions[&id].clone(),
                    catalog.hydrostatics.get(&id),
                )
                .unwrap(),
            )
        });
    }
    compiled
}
/// Stepping the battle far enough for shells, torpedoes, depth charges, air
/// releases, fires, flooding and losses to appear in the frame.
struct Coverage {
    seen: BTreeMap<&'static str, usize>,
}
impl Coverage {
    fn note(&mut self, frame: &Value) {
        for key in ["shells", "torpedoes", "depthCharges", "releases", "events"] {
            *self.seen.entry(key).or_default() += frame[key].as_array().map_or(0, Vec::len);
        }
        *self.seen.entry("impacts").or_default() += frame["events"].as_array().map_or(0, |e| {
            e.iter().filter(|e| e.get("impact").is_some()).count()
        });
        *self.seen.entry("shellHistory").or_default() += frame["records"]["shellHistory"]
            .as_array()
            .map_or(0, Vec::len);
    }
}

#[test]
fn full_frames_carry_exactly_the_declared_element_shapes() {
    let d = declarations();
    let catalog = catalog();
    let roster = [
        "bismarck",
        "yamato",
        "fletcher",
        "flower-corvette",
        "enterprise-cv6",
        "type-viic",
    ];
    let compiled = compile(&catalog, roster.iter().map(|s| s.to_string()));
    let ships: Vec<_> = ["a", "b"]
        .into_iter()
        .flat_map(|team| {
            roster.iter().enumerate().map(move |(i, id)| {
                json!({"id": format!("{team}-{i}"), "presetId": id, "team": team,
                    "controller": if team == "a" && i == 0 { "player" } else { "bot" },
                    "aiLevel": "normal", "spawn": null})
            })
        })
        .collect();
    let setup: BattleSetup = serde_json::from_value(json!({"ships": ships, "seed": 0x6e617661_u32,
        "mapId": "north-atlantic", "weather": "map", "spawnDistance": 3000, "windSpeed": 9}))
    .unwrap();
    let mut battle = Battle::new(catalog, &compiled, setup).unwrap();
    let mut coverage = Coverage {
        seen: BTreeMap::new(),
    };
    for tick in 0..2400u64 {
        if tick % 60 == 0 {
            let detail: Vec<String> = if tick % 120 == 0 {
                vec!["a-0".into(), "b-1".into()]
            } else {
                vec![]
            };
            let frame = received(&battle.full_frame(&detail));
            check_frame(&d, &frame, &format!("full tick {tick}"));
            coverage.note(&frame);
        }
        battle.step(&BTreeMap::new());
    }
    // Depth charges and air releases need a scripted encounter; the shapes the
    // fleet reaches on its own must all have been walked.
    for key in ["shells", "torpedoes", "events", "impacts", "shellHistory"] {
        assert!(
            coverage.seen[key] > 0,
            "the battle never carried any {key}: the check did not see that shape"
        );
    }
}

#[test]
fn team_frames_and_debriefs_carry_exactly_the_declared_element_shapes() {
    use naval_sim::pve::{PvePlan, PveRequest};
    let d = declarations();
    let catalog = catalog();
    let request: PveRequest = serde_json::from_value(json!({
        "version": 1, "seed": 17001, "mapId": "iron-bottom-sound", "weather": "clear",
        "difficulty": "normal",
        "ships": [{"id": "own", "presetId": "bismarck", "groupId": "g"},
            {"id": "carrier", "presetId": "enterprise-cv6", "groupId": "g"},
            {"id": "escort", "presetId": "fletcher", "groupId": "g"}],
        "groups": [{"id": "g", "name": "Fleet", "station": "front"}]
    }))
    .unwrap();
    let plan = PvePlan::generate(&catalog, request).unwrap();
    let setup = plan.restart_setup();
    let compiled = compile(&catalog, setup.ships.iter().map(|s| s.preset_id.clone()));
    let mut battle = Battle::new(catalog, &compiled, setup).unwrap();
    let detail = ["own".to_string()];
    let mut debriefed = false;
    for tick in 0..1200u64 {
        if tick % 100 == 0 {
            let frame = received(
                &battle
                    .team_frame(rules::TeamId::A, &detail)
                    .expect("team frame"),
            );
            check_frame(&d, &frame, &format!("team tick {tick}"));
            if let Some(debrief) = frame.get("debrief") {
                check_frame(&d, debrief, &format!("debrief tick {tick}"));
                debriefed = true;
            }
        }
        battle.step(&BTreeMap::new());
    }
    // A decided mission carries the full frame as its debrief; check that
    // shape directly when the sample above ended before a decision.
    if !debriefed {
        let frame = received(&battle.full_frame(&[]));
        check_frame(&d, &frame, "full frame as debrief");
    }
}
