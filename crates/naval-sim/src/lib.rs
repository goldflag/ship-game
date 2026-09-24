//! Renderer-free naval simulation shared by the native server and browser WASM.
pub mod catalog;
pub mod compartment_geometry;
pub mod construction;
mod construction_access;
mod construction_balcony;
mod construction_bilge_keels;
mod construction_cache;
mod construction_compact;
pub mod construction_custom_fittings;
mod construction_custom_hull;
mod construction_diagnostics;
pub mod construction_fitting_mesh;
pub mod construction_geometry;
mod construction_installation;
mod construction_mesh;
mod construction_orientation;
pub mod construction_overlap;
mod construction_parents;
mod construction_paths;
pub mod construction_placement;
mod construction_propellers;
mod construction_propulsion;
mod construction_services;
#[path = "../../../assets/parts/construction/hull_shapes.rs"]
pub mod construction_shapes;
mod construction_solid;
mod construction_transport;
mod construction_vertex;
pub mod definition;
pub mod fleet_evasion;
pub mod formations;
pub mod geometry;
pub mod installation_clearance;
pub mod maneuvering;
pub mod mobility;
pub mod motion;
pub mod mount_clearance;
pub mod mount_frames;
pub mod mount_rest;
pub mod navigation;
pub mod rules;

pub mod ballistics;

pub mod floodwater;
pub mod hull;
pub mod hydro_table;
pub mod hydrostatics;
mod volume_proxy;

pub mod environment;
pub mod terrain;

pub mod aviation;
pub mod bots;
pub mod breaches;
pub mod burst;
pub mod collisions;
pub mod contacts;
pub mod damage;
pub mod damage_control;
pub mod depth_charges;
mod flood_connections;
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
pub mod frame_vocabulary;
mod presentation;
pub mod snapshot;
mod team_view;
pub const SIMULATION_BUILD: &str = env!("NAVAL_SIMULATION_BUILD");

pub mod runtime_encoding;

mod construction_freeform;

mod construction_wall_fittings;
