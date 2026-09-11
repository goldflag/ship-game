use ts_rs::TS;
fn main() {
    naval_sim::air_recovery::CarrierRecovery::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::aircraft::SearchProgress::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::battle::BattleSetup::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::sensors::ContactTrack::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::recon::ReconCoverage::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::pve::PveRequest::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::pve::PveBriefing::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::pve::Placement::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::CommandEnvelope::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::MovementOrder::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::session::FleetOrderState::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::session::FleetNotice::export_all(&ts_rs::Config::from_env()).unwrap();
}
