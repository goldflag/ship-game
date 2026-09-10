//! Renderer-free naval simulation shared by the native server and browser WASM.
pub mod catalog;
pub mod definition;
pub mod fleet_evasion;
pub mod geometry;
pub mod mobility;
pub mod motion;
pub mod installation_clearance;
pub mod mount_clearance;
pub mod mount_frames;
pub mod navigation;
pub mod rules;

pub mod ballistics;

pub mod deck_contact;
pub mod deck_navigation;
pub mod deck_operations;
pub mod flight_deck;
pub mod floodwater;
pub mod hull;
pub mod hydrostatics;

pub mod environment;

pub mod trace;

pub mod air_gunnery;
pub mod air_rules;
pub mod aircraft;
pub mod aircraft_accuracy;
pub mod aircraft_deck;
pub mod aircraft_flight;
pub mod aircraft_formation;
pub mod aircraft_tactics;
pub mod aviation;
pub mod aviation_step;
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

pub mod battle;
pub mod mission;
pub mod pve;
mod pve_command;
pub mod recon;
pub mod sensors;

pub mod records;

mod presentation;
pub mod snapshot;
mod team_view;
pub const SIMULATION_BUILD: &str = env!("NAVAL_SIMULATION_BUILD");

pub mod air_recovery;
pub mod air_search;
pub mod pve_air;
