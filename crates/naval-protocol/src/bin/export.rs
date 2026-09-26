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
    naval_sim::scenario::ScenarioRequest::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::scenario::WithdrawReason::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::mission::Score::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::CommandEnvelope::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::MovementOrder::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::session::FleetOrderState::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_protocol::session::FleetNotice::export_all(&ts_rs::Config::from_env()).unwrap();
    // The frame and its codec: the session half flattens the battle half, whose
    // element projections are the client's own types (see BattleFrame).
    naval_protocol::frame::SessionFrame::<()>::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::snapshot::BattleFrame::<(), (), (), (), (), (), (), (), ()>::export_all(
        &ts_rs::Config::from_env(),
    )
    .unwrap();
    naval_sim::frame_delta::FrameUpdate::export_all(&ts_rs::Config::from_env()).unwrap();
    // The frame's element shapes: the simulation objects as the presentation
    // filter publishes them (dropped fields are `#[ts(skip)]`, projected ones
    // `#[ts(as = ..)]`), and the word sets their string fields carry.
    naval_sim::vessel::Vessel::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::aviation::CarrierWing::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::shell::Shell::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::torpedoes::Torpedo::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::depth_charges::DepthCharge::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::aviation::AirRelease::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::battle::Event::export_all(&ts_rs::Config::from_env()).unwrap();
    naval_sim::records::Records::export_all(&ts_rs::Config::from_env()).unwrap();
}
