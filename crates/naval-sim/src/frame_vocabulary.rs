//! The closed word sets the frame carries in `String` fields, declared once so
//! the client's generated types name them. The emitters still write the
//! strings (they predate these declarations); `tests/frame_types.rs` parses
//! every value a battle emits back through these enums, so a new word the
//! client would not know fails there rather than at a renderer branch.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `Event.kind`: what the battle reports for renderer effects and the log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum EventKind {
    Shot,
    Splash,
    Contact,
    Penetration,
    Ricochet,
    Stopped,
    Module,
    Sunk,
    Burst,
    TorpedoLaunch,
    TorpedoHit,
    TorpedoDud,
    TorpedoExpired,
    AircraftLaunch,
    AircraftRecovered,
    AircraftRelease,
    AircraftLost,
    AircraftCrash,
    AircraftFire,
    AircraftUnavailable,
    BombRelease,
    DepthChargeLaunch,
    DepthChargeSplash,
    DepthChargeBlast,
    DepthChargeHit,
    Collision,
    Grounding,
}
/// Why a hull was defeated (`DamageState.defeat_cause`, `Event.defeat_cause`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum DefeatCause {
    StructuralFallback,
    HullFailure,
    Flooding,
    Magazine,
    Capsize,
    WeaponsLost,
    AmmunitionExhausted,
}
/// `StabilityState.status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum VesselStatus {
    Operational,
    Immobile,
    Disarmed,
    Disabled,
    Sinking,
    Capsized,
}
/// `ConnectionState.state`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionStatus {
    Open,
    Closed,
    Damaged,
}
/// `TubeState.status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TubeStatus {
    Ready,
    Reloading,
    Turning,
    OutOfArc,
    OutOfRange,
    TooClose,
    Disabled,
    Empty,
    Blocked,
    TooDeep,
    AboveWater,
}
/// `DepthChargeLauncherState.status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum LauncherStatus {
    Ready,
    Reloading,
    Empty,
    Disabled,
}
/// `Aircraft.phase`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum FlightPhase {
    Withdrawn,
    Ready,
    Queued,
    Taxi,
    Takeoff,
    Outbound,
    Attack,
    Returning,
    Landing,
    Rollout,
    Parking,
    Rearming,
    Lost,
    Hangar,
    Raising,
    Lowering,
    Repairing,
    LaunchReady,
}
/// `Shell.type` and `ShellEffect.type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "UPPERCASE")]
pub enum ShellType {
    Ap,
    He,
}
/// `ImpactRecord.kind`: what a projectile met.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ImpactKind {
    Armor,
    Module,
    Mount,
    Boundary,
    Burst,
    Structure,
}
/// `ImpactRecord.fuze`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum FuzeState {
    Unarmed,
    Armed,
}
/// `ImpactRecord.outcome`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ImpactOutcome {
    Penetrated,
    Ricochet,
    Stopped,
    Damaged,
    Destroyed,
    Detonation,
    Backing,
}
/// `SurfaceImpact.outcome`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceOutcome {
    Penetration,
    Stopped,
    Ricochet,
}
/// `ShellHistory.outcome`: where a shell's story ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ShellOutcome {
    Flying,
    Splash,
    PassedThrough,
    Expired,
    Stopped,
    Ricochet,
    Internal,
    Burst,
}
