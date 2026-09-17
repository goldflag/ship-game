use ts_rs::TS;
fn main() {
    naval_protocol::FleetReference::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::aviation::CarrierRecovery::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::aviation::SearchProgress::export_all(&ts_rs::Config::from_env()).unwrap();
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
    // The frame and its codec: the session half flattens the battle half, whose
    // element projections are the client's own types (see BattleFrame).
    naval_protocol::frame::SessionFrame::<()>::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::snapshot::BattleFrame::<(), (), (), (), (), (), (), (), ()>::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::frame_delta::FrameUpdate::export_all(&ts_rs::Config::from_env()).unwrap();
}
