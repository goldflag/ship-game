use ts_rs::TS;
fn main() {
    naval_sim::battle::BattleSetup::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::sensors::ContactTrack::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::CommandEnvelope::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::MovementOrder::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::session::FleetOrderState::export_all(&ts_rs::Config::from_env()).unwrap();
}
