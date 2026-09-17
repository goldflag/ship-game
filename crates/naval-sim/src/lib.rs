//! Renderer-free naval simulation shared by the native server and browser WASM.
pub mod catalog;
pub mod construction_geometry;
pub mod compartment_geometry;
#[path = "../../../assets/parts/construction/hull_shapes.rs"]
pub mod construction_shapes;
pub mod construction;
mod construction_vertex;
mod construction_custom_hull;
mod construction_installation;
mod construction_services;
mod construction_paths;
mod construction_propellers;
pub mod definition;
pub mod fleet_evasion;
pub mod formations;
pub mod geometry;
pub mod mobility;
pub mod motion;
pub mod installation_clearance;
pub mod mount_clearance;
pub mod mount_frames;
pub mod navigation;
pub mod rules;

pub mod ballistics;

pub mod floodwater;
pub mod hull;
pub mod hydro_table;
pub mod hydrostatics;

pub mod environment;

pub mod aviation;
pub mod bots;
pub mod breaches;
pub mod burst;
pub mod collisions;
pub mod contacts;
pub mod damage;
pub mod damage_control;
pub mod depth_charges;
pub mod flooding;
pub mod hull_contact;
pub mod impact;
pub mod land;
pub mod machinery;
pub mod projectile;
pub mod protection;
pub mod shell;
pub mod stability;
pub mod structure;
pub mod submarine;
pub mod torpedoes;
pub mod vessel;
pub mod weapons;

pub mod anti_aircraft;
pub mod capability;

pub mod gunnery;

pub mod admiral;
pub mod battle;
pub mod captain;
pub mod mission;
pub mod pve;
pub mod recon;
pub mod sensors;

pub mod records;

pub mod frame_delta;
mod presentation;
pub mod snapshot;
mod team_view;
pub const SIMULATION_BUILD: &str = env!("NAVAL_SIMULATION_BUILD");

pub mod runtime_encoding;
