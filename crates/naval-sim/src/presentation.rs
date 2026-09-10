//! Stream the presentation projection without first allocating a JSON tree for
//! the entire authority state. Unmodified subtrees use their normal serializer.
use crate::{bots::AiLevel, snapshot::Snapshot, vessel::Vessel};
use serde::{
    Serialize, Serializer,
    ser::{Error, SerializeMap, SerializeSeq, SerializeStruct},
};

/// Keep both tree and streaming projections consistent. Only the small pilot
/// record needs a temporary value; hulls and other large state keep streaming.
pub(crate) fn aircraft_behavior(
    pilot: &serde_json::Value,
) -> serde_json::Map<String, serde_json::Value> {
    let mut behavior = serde_json::Map::new();
    for (name, value) in [
        ("recoveryNotice", &pilot["recovery"]["notice"]),
        ("evasionNotice", &pilot["defense"]["notice"]),
        ("maneuver", &pilot["maneuver"]["kind"]),
    ] {
        if value.is_string() {
            behavior.insert(name.into(), value.clone());
        }
    }
    behavior
}

pub(crate) struct Presentation<'a>(pub Snapshot<'a>);
impl Serialize for Presentation<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let f = &self.0;
        let mut s = serializer.serialize_struct("Snapshot", 12)?;
        s.serialize_field("tick", &f.tick)?;
        s.serialize_field("actors", &Actors(f.actors))?;
        s.serialize_field("wings", &Filtered(f.wings, Mode::Wing))?;
        s.serialize_field("shells", &Filtered(f.shells, Mode::Shell))?;
        s.serialize_field("torpedoes", f.torpedoes)?;
        s.serialize_field("depthCharges", f.depth_charges)?;
        s.serialize_field("releases", f.releases)?;
        s.serialize_field("events", f.events)?;
        s.serialize_field("outcome", f.outcome)?;
        s.serialize_field("records", f.records)?;
        s.serialize_field("afloatKg", &f.afloat_kg)?;
        s.serialize_field("remainingSeconds", &f.remaining_seconds)?;
        s.end()
    }
}
struct Actors<'a>(&'a [Vessel]);
impl Serialize for Actors<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_seq(Some(self.0.len()))?;
        for actor in self.0 {
            s.serialize_element(&Filtered(
                actor,
                Mode::Actor(actor.bot.as_ref().map(|b| b.ai_level)),
            ))?;
        }
        s.end()
    }
}

#[derive(Clone, Copy)]
enum Mode {
    Actor(Option<AiLevel>),
    Damage,
    Stability,
    Mount,
    AimCache,
    Wing,
    WingState,
    Plane,
    Shell,
}
#[derive(Clone, Copy)]
enum Field {
    Keep,
    Drop,
    Empty,
    Behavior,
    Nested(Mode),
}
impl Mode {
    fn field(self, key: &str) -> Field {
        match (self, key) {
            (Self::Actor(_), "bot")
            | (Self::Mount, "leadCache" | "aaDiscipline")
            | (Self::AimCache, "point") => Field::Drop,
            (Self::Plane, "pilot") => Field::Behavior,
            (Self::Actor(_), "damage") => Field::Nested(Self::Damage),
            (Self::Actor(_), "mounts") => Field::Nested(Self::Mount),
            (Self::Damage, "stability") => Field::Nested(Self::Stability),
            (Self::Stability, "water") => Field::Empty,
            (Self::Mount, "aimCache") => Field::Nested(Self::AimCache),
            (Self::Wing, "state") => Field::Nested(Self::WingState),
            (Self::WingState, "planes") => Field::Nested(Self::Plane),
            (
                Self::Shell,
                "visited"
                | "remainingModuleDamage"
                | "hullDamage"
                | "hullDamageConsumed"
                | "hullRegionDamage"
                | "equipmentDamage"
                | "wreckageShips"
                | "detonateAtAge"
                | "lastHitShipId"
                | "lodged",
            ) => Field::Drop,
            _ => Field::Keep,
        }
    }
}
struct Filtered<'a, T: ?Sized>(&'a T, Mode);
impl<T: Serialize + ?Sized> Serialize for Filtered<'_, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(FilterSerializer {
            inner: serializer,
            mode: self.1,
        })
    }
}
struct FilterSerializer<S> {
    inner: S,
    mode: Mode,
}
struct FilterStruct<S> {
    inner: S,
    mode: Mode,
}
struct FilterMap<S> {
    inner: S,
    mode: Mode,
    field: Field,
}
struct FilterSeq<S> {
    inner: S,
    mode: Mode,
}

impl<S: SerializeStruct> SerializeStruct for FilterStruct<S> {
    type Ok = S::Ok;
    type Error = S::Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), S::Error> {
        match self.mode.field(key) {
            Field::Keep => self.inner.serialize_field(key, value),
            Field::Drop => Ok(()),
            Field::Empty => self.inner.serialize_field(key, &[] as &[u8]),
            Field::Behavior => self.inner.serialize_field(
                "behavior",
                &aircraft_behavior(&serde_json::to_value(value).map_err(S::Error::custom)?),
            ),
            Field::Nested(mode) => self.inner.serialize_field(key, &Filtered(value, mode)),
        }
    }
    fn end(mut self) -> Result<S::Ok, S::Error> {
        if let Mode::Actor(Some(level)) = self.mode {
            self.inner.serialize_field("aiLevel", &level)?;
        }
        self.inner.end()
    }
}
impl<S: SerializeMap> SerializeMap for FilterMap<S> {
    type Ok = S::Ok;
    type Error = S::Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), S::Error> {
        // Only Vessel's flattened fields take this path; its large descendant
        // arrays/records stream directly without probing or allocating keys.
        let key_value = serde_json::to_value(key).map_err(S::Error::custom)?;
        let name = key_value
            .as_str()
            .ok_or_else(|| S::Error::custom("Presentation field must be a string"))?;
        self.field = self.mode.field(name);
        if matches!(self.field, Field::Drop) {
            Ok(())
        } else if matches!(self.field, Field::Behavior) {
            self.inner.serialize_key("behavior")
        } else {
            self.inner.serialize_key(key)
        }
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), S::Error> {
        match self.field {
            Field::Keep => self.inner.serialize_value(value),
            Field::Drop => Ok(()),
            Field::Empty => self.inner.serialize_value(&[] as &[u8]),
            Field::Behavior => self.inner.serialize_value(&aircraft_behavior(
                &serde_json::to_value(value).map_err(S::Error::custom)?,
            )),
            Field::Nested(mode) => self.inner.serialize_value(&Filtered(value, mode)),
        }
    }
    fn end(mut self) -> Result<S::Ok, S::Error> {
        if let Mode::Actor(Some(level)) = self.mode {
            self.inner.serialize_entry("aiLevel", &level)?;
        }
        self.inner.end()
    }
}
impl<S: SerializeSeq> SerializeSeq for FilterSeq<S> {
    type Ok = S::Ok;
    type Error = S::Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), S::Error> {
        self.inner.serialize_element(&Filtered(value, self.mode))
    }
    fn end(self) -> Result<S::Ok, S::Error> {
        self.inner.end()
    }
}

macro_rules! forward {
    ($($name:ident($($arg:ident: $ty:ty),*));* $(;)?) => { $(
        fn $name(self, $($arg: $ty),*) -> Result<Self::Ok, Self::Error> { self.inner.$name($($arg),*) }
    )* };
}
impl<S: Serializer> Serializer for FilterSerializer<S> {
    type Ok = S::Ok;
    type Error = S::Error;
    type SerializeSeq = FilterSeq<S::SerializeSeq>;
    type SerializeMap = FilterMap<S::SerializeMap>;
    type SerializeStruct = FilterStruct<S::SerializeStruct>;
    type SerializeTuple = S::SerializeTuple;
    type SerializeTupleStruct = S::SerializeTupleStruct;
    type SerializeTupleVariant = S::SerializeTupleVariant;
    type SerializeStructVariant = S::SerializeStructVariant;
    forward! {
        serialize_bool(v: bool); serialize_i8(v: i8); serialize_i16(v: i16); serialize_i32(v: i32); serialize_i64(v: i64); serialize_i128(v: i128);
        serialize_u8(v: u8); serialize_u16(v: u16); serialize_u32(v: u32); serialize_u64(v: u64); serialize_u128(v: u128);
        serialize_f32(v: f32); serialize_f64(v: f64); serialize_char(v: char); serialize_str(v: &str); serialize_bytes(v: &[u8]);
        serialize_none(); serialize_unit(); serialize_unit_struct(name: &'static str);
        serialize_unit_variant(name: &'static str, index: u32, variant: &'static str);
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<S::Ok, S::Error> {
        self.inner.serialize_some(&Filtered(value, self.mode))
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        name: &'static str,
        value: &T,
    ) -> Result<S::Ok, S::Error> {
        self.inner
            .serialize_newtype_struct(name, &Filtered(value, self.mode))
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<S::Ok, S::Error> {
        self.inner
            .serialize_newtype_variant(name, index, variant, value)
    }
    fn serialize_seq(self, len: Option<usize>) -> Result<Self::SerializeSeq, S::Error> {
        Ok(FilterSeq {
            inner: self.inner.serialize_seq(len)?,
            mode: self.mode,
        })
    }
    fn serialize_map(self, _len: Option<usize>) -> Result<Self::SerializeMap, S::Error> {
        Ok(FilterMap {
            inner: self.inner.serialize_map(None)?,
            mode: self.mode,
            field: Field::Keep,
        })
    }
    fn serialize_struct(
        self,
        name: &'static str,
        len: usize,
    ) -> Result<Self::SerializeStruct, S::Error> {
        Ok(FilterStruct {
            inner: self.inner.serialize_struct(name, len)?,
            mode: self.mode,
        })
    }
    fn serialize_tuple(self, len: usize) -> Result<Self::SerializeTuple, S::Error> {
        self.inner.serialize_tuple(len)
    }
    fn serialize_tuple_struct(
        self,
        name: &'static str,
        len: usize,
    ) -> Result<Self::SerializeTupleStruct, S::Error> {
        self.inner.serialize_tuple_struct(name, len)
    }
    fn serialize_tuple_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self::SerializeTupleVariant, S::Error> {
        self.inner
            .serialize_tuple_variant(name, index, variant, len)
    }
    fn serialize_struct_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self::SerializeStructVariant, S::Error> {
        self.inner
            .serialize_struct_variant(name, index, variant, len)
    }
    fn is_human_readable(&self) -> bool {
        self.inner.is_human_readable()
    }
}
