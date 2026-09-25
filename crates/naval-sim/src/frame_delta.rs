//! The one frame codec. A presentation frame leaves Rust as a patch against a
//! reference frame the receiver already holds, in the shape
//! `src/game/session/frameDelta.ts` applies; the receiver copies the changed
//! paths onto its reference and holds the result. Two transports use it:
//!
//! - the custom-battle worker, whose reference is the frame it published last
//!   (ordered, lossless: one request, one reply), and
//! - the match server, whose reference is the immutable match baseline every
//!   client received on admission, so a slow socket can skip any frame
//!   ([`FrameDelta::fork`] gives each publication a fresh encoder on that
//!   baseline).
//!
//! The patch comes from a `Serializer` that walks the live simulation once,
//! comparing each leaf against a shadow of the reference frame and writing only
//! what moved. The shadow keeps fields in the order the serializer produces
//! them, so a field is found by advancing a cursor rather than by looking a key
//! up in a map, and it is stored unparsed and unboxed so that an unchanged
//! number costs a comparison and nothing else.
//!
//! The codec owns the frame's null invariant: an object field whose value is
//! null has no key on the receiver, so the first frame travels without it and a
//! later null reports the key as removed. Neither transport nor the receiver
//! strips nulls again. The one exception, [`KEEP_NULL`], is declared next to the
//! field that needs it.
use serde::{
    Deserialize, Serialize, Serializer,
    ser::{
        Error as _, Impossible, SerializeMap, SerializeSeq, SerializeStruct,
        SerializeStructVariant, SerializeTuple, SerializeTupleStruct, SerializeTupleVariant,
    },
};
use serde_json::Value;
use std::fmt::Write as _;
use ts_rs::TS;

/// The one field where an explicit null is an operating policy ("unlimited")
/// rather than a missing optional, so it travels and the receiver keeps it. The
/// field declares it; see `DeckStatus` in the aviation deck operations.
pub const KEEP_NULL: &str = crate::aviation::ACTIVE_FLIGHT_LIMIT_FIELD;

type Error = serde_json::Error;

/// What both transports send: the tick of the reference frame the receiver
/// must be holding (`null` when this update carries a whole frame and the
/// receiver holds nothing), the tick the frame reaches, and the patch between
/// them, absent when nothing moved. [`FrameDelta::update`] writes it; this
/// declaration is what the client decodes and what the tests read it back as.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FrameUpdate {
    #[ts(type = "number | null")]
    pub base_tick: Option<u64>,
    #[ts(type = "number")]
    pub tick: u64,
    #[serde(default)]
    #[ts(optional, as = "Option<FramePatch>")]
    pub delta: Option<Value>,
}

/// The patch grammar. A scalar is its own replacement; a replaced object or
/// array is wrapped in `value`, because a bare object would read as a nested
/// patch; `array` patches elements in place (a length change replaces the
/// array whole); `object` patches fields and lists the keys that went away.
/// A [`keyed`] array whose elements came and went also carries `from`, runs of
/// `[index, previous index, count]` that copy surviving elements to where they
/// now sit, and its new `length`; its `array` patches then apply to that array,
/// and they cover every index no run does.
#[derive(TS)]
#[ts(export)]
pub struct FramePatch(
    #[ts(
        type = "string | number | boolean | null | { value: unknown } | { array: Array<[number, FramePatch]>, from?: Array<[number, number, number]>, length?: number } | { object: { [key in string]: FramePatch }, removed?: Array<string> }"
    )]
    (),
);

/// The newtype name that marks a [`keyed`] collection to the encoder.
const KEYED: &str = "\u{0}frame_delta::keyed";

/// `#[serde(serialize_with)]` for a collection whose elements are objects that
/// lead with a unique key (a sequence number, a shell id) and keep their order
/// while elements leave from anywhere and arrive at the end: the event window,
/// the shell record, the shells in flight. Patched by index, one arrival shifts
/// every later element and a length change resends the whole collection; keyed,
/// each element is matched to its previous self by that first field, the
/// client copies the survivors and only what arrived or changed travels. Every
/// other serializer sees the collection unwrapped.
pub fn keyed<T: Serialize + ?Sized, S: Serializer>(
    value: &T,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_newtype_struct(KEYED, value)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Outcome {
    Unchanged,
    Changed,
    /// A null object field: the decoded frame has no such key on either side.
    Null,
}

/// A field name. Struct fields borrow a name that outlives the battle, and the
/// same pointer arrives every frame, so most comparisons are a pointer test.
#[derive(Clone)]
enum Name {
    Static(&'static str),
    Owned(Box<str>),
}
impl Name {
    fn as_str(&self) -> &str {
        match self {
            Self::Static(name) => name,
            Self::Owned(name) => name,
        }
    }
    fn is(&self, key: &str) -> bool {
        let name = self.as_str();
        std::ptr::eq(name.as_ptr(), key.as_ptr()) && name.len() == key.len() || name == key
    }
}

/// The previous frame, held the way the walk reads it. Numbers and booleans are
/// unboxed; the shapes the walk does not descend into keep their rendered text.
#[derive(Clone, Default)]
enum Node {
    #[default]
    Null,
    Bool(bool),
    Int(i128),
    Float(f64),
    Text(Box<str>),
    Array(Vec<Node>),
    Object(Vec<(Name, Node)>),
    /// Pre-rendered JSON for shapes compared whole rather than walked.
    Raw(Box<str>),
}

impl Node {
    /// Leaves only: containers are compared by walking them.
    fn same(&self, other: &Node) -> bool {
        match (self, other) {
            (Self::Null, Self::Null) => true,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Int(a), Self::Int(b)) => a == b,
            // Bit for bit, so a sign flip on zero still reaches the renderer.
            (Self::Float(a), Self::Float(b)) => a.to_bits() == b.to_bits(),
            (Self::Text(a), Self::Text(b)) => a == b,
            (Self::Raw(a), Self::Raw(b)) => a == b,
            _ => false,
        }
    }
    fn container(&self) -> bool {
        matches!(self, Self::Array(_) | Self::Object(_))
            || matches!(self, Self::Raw(text) if text.starts_with(['{', '[']))
    }
    fn write(&self, out: &mut String) {
        match self {
            Self::Null => out.push_str("null"),
            Self::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Self::Int(value) => {
                let _ = write!(out, "{value}");
            }
            Self::Float(value) => write_f64(out, *value),
            Self::Text(value) => write_text(out, value),
            Self::Array(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Self::Object(entries) => {
                out.push('{');
                for (index, (name, value)) in entries.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write_key(out, name.as_str());
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
            Self::Raw(text) => out.push_str(text),
        }
    }
    fn field(&self, key: &str) -> Option<&Node> {
        match self {
            Self::Object(entries) => entries.iter().find(|(name, _)| name.is(key)).map(|e| &e.1),
            _ => None,
        }
    }
}

/// Patch text is written only once something has actually changed. Keys and
/// container headers wait in `pending`; the first leaf that moves flushes the
/// ancestors that lead to it, and a subtree that turns out to be unchanged winds
/// the buffers back. Nothing speculative reaches `out`, so the fields that did
/// not move cost no formatting at all.
#[derive(Default)]
struct Ctx {
    out: String,
    pending: String,
    flushed: usize,
}
#[derive(Clone, Copy)]
struct Mark {
    out: usize,
    pending: usize,
    flushed: usize,
}
impl Ctx {
    fn mark(&self) -> Mark {
        Mark {
            out: self.out.len(),
            pending: self.pending.len(),
            flushed: self.flushed,
        }
    }
    fn flush(&mut self) {
        if self.flushed < self.pending.len() {
            self.out.push_str(&self.pending[self.flushed..]);
            self.flushed = self.pending.len();
        }
    }
    fn restore(&mut self, mark: Mark) {
        self.out.truncate(mark.out);
        self.pending.truncate(mark.pending);
        self.flushed = mark.flushed;
    }
}

/// The previous frame and the buffers the walk reuses. One per publication
/// stream: the local runtime keeps exactly one, reset whenever the client's
/// baseline is discarded (init, deploy, restart).
#[derive(Default)]
pub struct FrameDelta {
    shadow: Node,
    ctx: Ctx,
}

impl FrameDelta {
    /// The tick the client is holding, so a stream that lost a reply is caught
    /// rather than silently applied to the wrong baseline.
    pub fn baseline_tick(&self) -> Option<u64> {
        match self.shadow.field("tick") {
            Some(Node::Int(tick)) => u64::try_from(*tick).ok(),
            _ => None,
        }
    }
    pub fn has_baseline(&self) -> bool {
        !matches!(self.shadow, Node::Null)
    }
    /// Forget the baseline. The next frame travels whole.
    pub fn reset(&mut self) {
        self.shadow = Node::Null;
    }
    /// The patch text for the frame just encoded; empty when nothing moved.
    pub fn patch(&self) -> &str {
        &self.ctx.out
    }
    /// Encode `frame` against the baseline, reporting whether anything moved.
    /// The patch stays in this buffer, reused frame after frame.
    pub fn encode<T: Serialize + ?Sized>(&mut self, frame: &T) -> Result<bool, Error> {
        self.ctx.out.clear();
        self.walk(frame)
    }
    /// The walk itself, appending to whatever `out` already holds.
    fn walk<T: Serialize + ?Sized>(&mut self, frame: &T) -> Result<bool, Error> {
        self.ctx.pending.clear();
        self.ctx.flushed = 0;
        let outcome = frame.serialize(Diff {
            shadow: &mut self.shadow,
            ctx: &mut self.ctx,
            in_object: false,
            keyed: false,
        });
        match outcome {
            Ok(Outcome::Unchanged) => Ok(false),
            Ok(_) => Ok(true),
            // An aborted walk leaves the shadow astride two frames. Drop it so
            // the next call sends a complete frame instead of a bad patch.
            Err(error) => {
                self.reset();
                self.ctx.out.clear();
                Err(error)
            }
        }
    }
    /// Encode `frame`, which reaches `tick`, as the [`FrameUpdate`] envelope:
    /// `{"baseTick":n|null,"tick":n,"delta":<patch>}`, `delta` absent when
    /// nothing moved. This is the text both transports send. The buffer is
    /// reused frame after frame.
    pub fn update<T: Serialize + ?Sized>(&mut self, tick: u64, frame: &T) -> Result<&str, Error> {
        let out = &mut self.ctx.out;
        out.clear();
        out.push_str("{\"baseTick\":");
        match self.baseline_tick() {
            Some(base) => push_index(&mut self.ctx.out, base as usize),
            None => self.ctx.out.push_str("null"),
        }
        self.ctx.out.push_str(",\"tick\":");
        push_index(&mut self.ctx.out, tick as usize);
        let envelope = self.ctx.out.len();
        self.ctx.out.push_str(",\"delta\":");
        if !self.walk(frame)? {
            self.ctx.out.truncate(envelope);
        }
        self.ctx.out.push('}');
        Ok(&self.ctx.out)
    }
    /// A fresh encoder holding this one's baseline: the match server forks its
    /// immutable baseline for every publication, so each update is a patch
    /// against the frame every client received on admission and any update
    /// can be skipped. The reused buffers are not carried over.
    pub fn fork(&self) -> FrameDelta {
        FrameDelta {
            shadow: self.shadow.clone(),
            ctx: Ctx::default(),
        }
    }
    /// `frame` as complete text, normalized exactly as a patched-together
    /// frame is: the shape a receiver holding nothing would hold after the
    /// first update. Baselines, migration checks and the complete-frame
    /// diagnostics read this rather than serde_json's rendering of the frame,
    /// so no consumer strips nulls a second time.
    pub fn complete<T: Serialize + ?Sized>(frame: &T) -> Result<String, Error> {
        let mut delta = FrameDelta::default();
        delta.encode(frame)?;
        let mut out = String::with_capacity(delta.ctx.out.len());
        delta.shadow.write(&mut out);
        Ok(out)
    }
}

/// serde_json's own number formatting, so the client parses exactly the text the
/// complete projection would have produced. Non-finite floats are null there too.
fn write_f64(out: &mut String, value: f64) {
    match serde_json::Number::from_f64(value) {
        Some(number) => {
            let _ = write!(out, "{number}");
        }
        None => out.push_str("null"),
    }
}

fn write_text(out: &mut String, text: &str) {
    match serde_json::to_string(text) {
        Ok(escaped) => out.push_str(&escaped),
        Err(_) => out.push_str("\"\""),
    }
}

fn write_key(out: &mut String, key: &str) {
    if key
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        out.push('"');
        out.push_str(key);
        out.push('"');
    } else {
        write_text(out, key);
    }
}

fn push_index(out: &mut String, value: usize) {
    let mut digits = [0u8; 20];
    let mut at = digits.len();
    let mut left = value;
    loop {
        at -= 1;
        digits[at] = b'0' + (left % 10) as u8;
        left /= 10;
        if left == 0 {
            break;
        }
    }
    out.push_str(std::str::from_utf8(&digits[at..]).unwrap_or("0"));
}

/// Scalars are their own patch; a replaced object or array is wrapped, because
/// an unwrapped object would be read as a nested patch.
fn write_replacement(out: &mut String, node: &Node) {
    if node.container() {
        out.push_str("{\"value\":");
        node.write(out);
        out.push('}');
    } else {
        node.write(out);
    }
}

/// Strip what the client's decoder strips, for the values compared whole.
fn normalize(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|key, value| !value.is_null() || key == KEEP_NULL);
            for (_, value) in map.iter_mut() {
                normalize(value);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize),
        _ => {}
    }
}

struct Diff<'a> {
    shadow: &'a mut Node,
    ctx: &'a mut Ctx,
    /// Inside an object a null value removes the key rather than writing null.
    in_object: bool,
    /// The sequence about to be walked is a [`keyed`] collection.
    keyed: bool,
}

impl Diff<'_> {
    fn set(self, node: Node) -> Result<Outcome, Error> {
        if self.in_object && matches!(node, Node::Null) {
            return Ok(Outcome::Null);
        }
        if self.shadow.same(&node) {
            return Ok(Outcome::Unchanged);
        }
        self.ctx.flush();
        write_replacement(&mut self.ctx.out, &node);
        *self.shadow = node;
        Ok(Outcome::Changed)
    }
    /// Rare shapes (128-bit integers, data-carrying enum variants) are rendered
    /// and compared whole rather than walked.
    fn whole<T: Serialize + ?Sized>(self, value: &T) -> Result<Outcome, Error> {
        let mut value = serde_json::to_value(value)?;
        normalize(&mut value);
        if value.is_null() {
            return self.set(Node::Null);
        }
        self.set(Node::Raw(serde_json::to_string(&value)?.into()))
    }
}

/// Reads the key a [`keyed`] element leads with, the scalar value of its first
/// field, and nothing else. `field` is set while probing that value.
#[derive(Clone, Copy)]
struct KeyProbe {
    field: bool,
}
/// The first field's key, once seen.
struct FirstField(Option<Option<Node>>);
type NoKey = Impossible<Option<Node>, Error>;
impl KeyProbe {
    fn key(self, node: Node) -> Result<Option<Node>, Error> {
        Ok(self.field.then_some(node))
    }
    fn no_key<T>(self) -> Result<T, Error> {
        Err(Error::custom("no key"))
    }
}
macro_rules! probe_integer {
    ($($name:ident($ty:ty));* $(;)?) => { $(
        fn $name(self, value: $ty) -> Result<Option<Node>, Error> { self.key(Node::Int(value.into())) }
    )* };
}
impl Serializer for KeyProbe {
    type Ok = Option<Node>;
    type Error = Error;
    type SerializeSeq = NoKey;
    type SerializeTuple = NoKey;
    type SerializeTupleStruct = NoKey;
    type SerializeTupleVariant = NoKey;
    type SerializeMap = FirstField;
    type SerializeStruct = FirstField;
    type SerializeStructVariant = NoKey;
    probe_integer! {
        serialize_i8(i8); serialize_i16(i16); serialize_i32(i32); serialize_i64(i64); serialize_i128(i128);
        serialize_u8(u8); serialize_u16(u16); serialize_u32(u32); serialize_u64(u64);
    }
    fn serialize_u128(self, value: u128) -> Result<Option<Node>, Error> {
        i128::try_from(value).map_or(Ok(None), |value| self.key(Node::Int(value)))
    }
    fn serialize_bool(self, value: bool) -> Result<Option<Node>, Error> {
        self.key(Node::Bool(value))
    }
    fn serialize_f32(self, value: f32) -> Result<Option<Node>, Error> {
        self.serialize_f64(value.into())
    }
    fn serialize_f64(self, value: f64) -> Result<Option<Node>, Error> {
        if value.is_finite() {
            self.key(Node::Float(value))
        } else {
            Ok(None)
        }
    }
    fn serialize_char(self, value: char) -> Result<Option<Node>, Error> {
        self.key(Node::Text(value.to_string().into()))
    }
    fn serialize_str(self, value: &str) -> Result<Option<Node>, Error> {
        self.key(Node::Text(value.into()))
    }
    fn serialize_bytes(self, _value: &[u8]) -> Result<Option<Node>, Error> {
        Ok(None)
    }
    fn serialize_none(self) -> Result<Option<Node>, Error> {
        Ok(None)
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Option<Node>, Error> {
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<Option<Node>, Error> {
        Ok(None)
    }
    fn serialize_unit_struct(self, _name: &'static str) -> Result<Option<Node>, Error> {
        Ok(None)
    }
    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
    ) -> Result<Option<Node>, Error> {
        self.serialize_str(variant)
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        value: &T,
    ) -> Result<Option<Node>, Error> {
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _index: u32,
        _variant: &'static str,
        _value: &T,
    ) -> Result<Option<Node>, Error> {
        Ok(None)
    }
    fn serialize_seq(self, _len: Option<usize>) -> Result<NoKey, Error> {
        self.no_key()
    }
    fn serialize_tuple(self, _len: usize) -> Result<NoKey, Error> {
        self.no_key()
    }
    fn serialize_tuple_struct(self, _name: &'static str, _len: usize) -> Result<NoKey, Error> {
        self.no_key()
    }
    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<NoKey, Error> {
        self.no_key()
    }
    /// The element: its first field holds the key. A nested object is not one.
    fn serialize_map(self, _len: Option<usize>) -> Result<FirstField, Error> {
        if self.field {
            self.no_key()
        } else {
            Ok(FirstField(None))
        }
    }
    fn serialize_struct(self, _name: &'static str, _len: usize) -> Result<FirstField, Error> {
        self.serialize_map(None)
    }
    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<NoKey, Error> {
        self.no_key()
    }
}
impl FirstField {
    fn take<T: Serialize + ?Sized>(&mut self, value: &T) {
        if self.0.is_none() {
            self.0 = Some(value.serialize(KeyProbe { field: true }).unwrap_or(None));
        }
    }
}
impl SerializeStruct for FirstField {
    type Ok = Option<Node>;
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        _key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.take(value);
        Ok(())
    }
    fn end(self) -> Result<Option<Node>, Error> {
        Ok(self.0.flatten())
    }
}
impl SerializeMap for FirstField {
    type Ok = Option<Node>;
    type Error = Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, _key: &T) -> Result<(), Error> {
        Ok(())
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.take(value);
        Ok(())
    }
    fn end(self) -> Result<Option<Node>, Error> {
        Ok(self.0.flatten())
    }
}

struct DiffObject<'a> {
    shadow: &'a mut Node,
    ctx: &'a mut Ctx,
    mark: Mark,
    /// Fields already matched this frame sit before it, in emission order.
    cursor: usize,
    /// The previous frame had something other than an object here, so the whole
    /// object travels instead of a patch against a shape the client never had.
    replace: bool,
    changed: bool,
    first: bool,
    pending_key: Option<Name>,
    /// Fields that turned null this frame. The client still has their keys.
    dropped: Vec<Name>,
}

impl<'a> DiffObject<'a> {
    fn new(diff: Diff<'a>) -> Self {
        let replace = !matches!(diff.shadow, Node::Object(_));
        if replace {
            *diff.shadow = Node::Object(Vec::new());
        }
        let mark = diff.ctx.mark();
        diff.ctx.pending.push_str("{\"object\":{");
        Self {
            shadow: diff.shadow,
            ctx: diff.ctx,
            mark,
            cursor: 0,
            replace,
            changed: false,
            first: true,
            pending_key: None,
            dropped: Vec::new(),
        }
    }
    fn field<T: Serialize + ?Sized>(&mut self, name: Name, value: &T) -> Result<(), Error> {
        let in_object = name.as_str() != KEEP_NULL;
        let mark = self.ctx.mark();
        if !self.first {
            self.ctx.pending.push(',');
        }
        write_key(&mut self.ctx.pending, name.as_str());
        self.ctx.pending.push(':');
        let at = self.cursor;
        let Node::Object(entries) = &mut *self.shadow else {
            return Err(Error::custom("Frame shadow lost its object"));
        };
        // The serializer emits the same fields in the same order every frame,
        // so the cursor is nearly always already on this one. A field that
        // reappears out of order rotates back into place; a new one is inserted
        // where it was emitted, which keeps the shadow's order the frame's.
        let mut fresh = false;
        if !(at < entries.len() && entries[at].0.is(name.as_str())) {
            match entries
                .get(at + 1..)
                .and_then(|rest| rest.iter().position(|(key, _)| key.is(name.as_str())))
            {
                Some(offset) => entries[at..=at + 1 + offset].rotate_right(1),
                None => {
                    entries.insert(at, (name, Node::Null));
                    fresh = true;
                }
            }
        }
        let outcome = value.serialize(Diff {
            shadow: &mut entries[at].1,
            ctx: self.ctx,
            in_object,
            keyed: false,
        })?;
        match outcome {
            Outcome::Unchanged => {
                self.ctx.restore(mark);
                self.cursor += 1;
            }
            Outcome::Changed => {
                self.first = false;
                self.changed = true;
                self.cursor += 1;
            }
            Outcome::Null => {
                self.ctx.restore(mark);
                let Node::Object(entries) = &mut *self.shadow else {
                    return Err(Error::custom("Frame shadow lost its object"));
                };
                let (name, _) = entries.remove(at);
                // A field the client already has needs an explicit removal; one
                // that was never sent simply stays absent.
                if !fresh {
                    self.dropped.push(name);
                }
            }
        }
        Ok(())
    }
    fn finish(mut self) -> Result<Outcome, Error> {
        // Whatever the cursor never reached is a field this frame no longer has.
        let at = self.cursor;
        let mut removed = std::mem::take(&mut self.dropped);
        let Node::Object(entries) = &mut *self.shadow else {
            return Err(Error::custom("Frame shadow lost its object"));
        };
        removed.extend(entries.split_off(at).into_iter().map(|(name, _)| name));
        if self.replace {
            self.ctx.restore(self.mark);
            self.ctx.flush();
            write_replacement(&mut self.ctx.out, self.shadow);
            return Ok(Outcome::Changed);
        }
        if !self.changed && removed.is_empty() {
            self.ctx.restore(self.mark);
            return Ok(Outcome::Unchanged);
        }
        // Removals alone still need the header no field flushed.
        self.ctx.flush();
        self.ctx.out.push('}');
        if !removed.is_empty() {
            self.ctx.out.push_str(",\"removed\":[");
            for (index, name) in removed.iter().enumerate() {
                if index > 0 {
                    self.ctx.out.push(',');
                }
                write_key(&mut self.ctx.out, name.as_str());
            }
            self.ctx.out.push(']');
        }
        self.ctx.out.push('}');
        Ok(Outcome::Changed)
    }
}

struct DiffSeq<'a> {
    shadow: &'a mut Node,
    ctx: &'a mut Ctx,
    mark: Mark,
    previous: usize,
    index: usize,
    replace: bool,
    changed: bool,
    first: bool,
    keyed: Option<Keyed>,
}

/// A [`keyed`] collection's walk: the previous elements, claimed in order.
struct Keyed {
    previous: Vec<Node>,
    /// Every element before this one is claimed or gone.
    cursor: usize,
    /// `[index, previous index, count]` for the elements claimed.
    runs: Vec<[usize; 3]>,
}

/// The key a [`keyed`] element leads with, as the shadow holds it.
fn key_of(node: &Node) -> Option<&Node> {
    match node {
        Node::Object(entries) => entries.first().map(|(_, value)| value).filter(|value| {
            matches!(
                value,
                Node::Int(_) | Node::Float(_) | Node::Text(_) | Node::Bool(_)
            )
        }),
        _ => None,
    }
}

impl<'a> DiffSeq<'a> {
    fn new(diff: Diff<'a>) -> Self {
        let replace = !matches!(diff.shadow, Node::Array(_));
        if replace {
            *diff.shadow = Node::Array(Vec::new());
        }
        let previous = match &*diff.shadow {
            Node::Array(items) => items.len(),
            _ => 0,
        };
        // A keyed walk rebuilds the array from the elements it claims.
        let keyed = diff.keyed.then(|| Keyed {
            previous: match &mut *diff.shadow {
                Node::Array(items) => std::mem::take(items),
                _ => Vec::new(),
            },
            cursor: 0,
            runs: Vec::new(),
        });
        let mark = diff.ctx.mark();
        diff.ctx.pending.push_str("{\"array\":[");
        Self {
            shadow: diff.shadow,
            ctx: diff.ctx,
            mark,
            previous,
            index: 0,
            replace,
            changed: false,
            first: true,
            keyed,
        }
    }
    fn items(&mut self) -> Result<&mut Vec<Node>, Error> {
        match self.shadow {
            Node::Array(items) => Ok(items),
            _ => Err(Error::custom("Frame shadow lost its array")),
        }
    }
    fn element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        if self.keyed.is_some() {
            return self.keyed_element(value);
        }
        let mark = self.ctx.mark();
        if !self.first {
            self.ctx.pending.push(',');
        }
        self.ctx.pending.push('[');
        push_index(&mut self.ctx.pending, self.index);
        self.ctx.pending.push(',');
        let at = self.index;
        let Node::Array(items) = &mut *self.shadow else {
            return Err(Error::custom("Frame shadow lost its array"));
        };
        if at >= items.len() {
            items.push(Node::Null);
        }
        let outcome = value.serialize(Diff {
            shadow: &mut items[at],
            ctx: self.ctx,
            in_object: false,
            keyed: false,
        })?;
        match outcome {
            Outcome::Changed => {
                self.ctx.out.push(']');
                self.first = false;
                self.changed = true;
            }
            Outcome::Unchanged | Outcome::Null => self.ctx.restore(mark),
        }
        self.index += 1;
        Ok(())
    }
    /// Claim the previous element with this one's key, or the next unclaimed one
    /// when none has it, and patch against it; with nothing left to claim the
    /// element travels whole.
    fn keyed_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        let Some(keyed) = self.keyed.as_mut() else {
            return Err(Error::custom("Frame walk lost its keyed collection"));
        };
        let key = value.serialize(KeyProbe { field: false }).unwrap_or(None);
        let claim = key
            .as_ref()
            .and_then(|key| {
                (keyed.cursor..keyed.previous.len())
                    .find(|&at| key_of(&keyed.previous[at]).is_some_and(|old| old.same(key)))
            })
            .or_else(|| (keyed.cursor < keyed.previous.len()).then_some(keyed.cursor));
        let mut node = claim.map_or(Node::Null, |at| std::mem::take(&mut keyed.previous[at]));
        if let Some(at) = claim {
            keyed.cursor = at + 1;
            match keyed.runs.last_mut() {
                Some([index, from, count])
                    if *index + *count == self.index && *from + *count == at =>
                {
                    *count += 1
                }
                _ => keyed.runs.push([self.index, at, 1]),
            }
        }
        let mark = self.ctx.mark();
        if !self.first {
            self.ctx.pending.push(',');
        }
        self.ctx.pending.push('[');
        push_index(&mut self.ctx.pending, self.index);
        self.ctx.pending.push(',');
        let outcome = value.serialize(Diff {
            shadow: &mut node,
            ctx: self.ctx,
            in_object: false,
            keyed: false,
        })?;
        if outcome == Outcome::Changed {
            self.ctx.out.push(']');
        } else if claim.is_none() {
            // A new null element matches its empty shadow, but the client has no slot for it yet.
            self.ctx.flush();
            self.ctx.out.push_str("null]");
        } else {
            self.ctx.restore(mark);
        }
        if outcome == Outcome::Changed || claim.is_none() {
            self.first = false;
            self.changed = true;
        }
        self.items()?.push(node);
        self.index += 1;
        Ok(())
    }
    fn keyed_finish(self, keyed: Keyed) -> Result<Outcome, Error> {
        let length = self.index;
        let in_place =
            length == keyed.previous.len() && (length == 0 || keyed.runs == [[0, 0, length]]);
        if self.replace || (!in_place && keyed.runs.is_empty()) {
            // Nothing survived: the array whole is shorter than its elements one by one.
            self.ctx.restore(self.mark);
            self.ctx.flush();
            write_replacement(&mut self.ctx.out, self.shadow);
            return Ok(Outcome::Changed);
        }
        if in_place {
            if !self.changed {
                self.ctx.restore(self.mark);
                return Ok(Outcome::Unchanged);
            }
            self.ctx.out.push_str("]}");
            return Ok(Outcome::Changed);
        }
        // Elements moved or went: the header travels even when no element changed.
        self.ctx.flush();
        self.ctx.out.push_str("],\"from\":[");
        for (index, run) in keyed.runs.iter().enumerate() {
            if index > 0 {
                self.ctx.out.push(',');
            }
            self.ctx.out.push('[');
            for (part, value) in run.iter().enumerate() {
                if part > 0 {
                    self.ctx.out.push(',');
                }
                push_index(&mut self.ctx.out, *value);
            }
            self.ctx.out.push(']');
        }
        self.ctx.out.push_str("],\"length\":");
        push_index(&mut self.ctx.out, length);
        self.ctx.out.push('}');
        Ok(Outcome::Changed)
    }
    fn finish(mut self) -> Result<Outcome, Error> {
        if let Some(keyed) = self.keyed.take() {
            return self.keyed_finish(keyed);
        }
        let length_changed = self.replace || self.index != self.previous;
        if length_changed {
            let at = self.index;
            self.items()?.truncate(at);
            // Indexed patches cannot express a length change; the client's own
            // differ replaces such arrays too.
            self.ctx.restore(self.mark);
            self.ctx.flush();
            self.ctx.out.push_str("{\"value\":");
            self.shadow.write(&mut self.ctx.out);
            self.ctx.out.push('}');
            return Ok(Outcome::Changed);
        }
        if !self.changed {
            self.ctx.restore(self.mark);
            return Ok(Outcome::Unchanged);
        }
        self.ctx.out.push_str("]}");
        Ok(Outcome::Changed)
    }
}

/// Data-carrying enum variants: collected into a value and compared whole.
struct DiffVariant<'a> {
    diff: Diff<'a>,
    variant: &'static str,
    items: Vec<Value>,
    fields: serde_json::Map<String, Value>,
}
impl DiffVariant<'_> {
    fn finish(self, content: Value) -> Result<Outcome, Error> {
        let wrapped = serde_json::json!({ self.variant.to_owned(): content });
        self.diff.whole(&wrapped)
    }
}

macro_rules! integer {
    ($($name:ident($ty:ty));* $(;)?) => { $(
        fn $name(self, value: $ty) -> Result<Outcome, Error> { self.set(Node::Int(value.into())) }
    )* };
}

impl<'a> Serializer for Diff<'a> {
    type Ok = Outcome;
    type Error = Error;
    type SerializeSeq = DiffSeq<'a>;
    type SerializeTuple = DiffSeq<'a>;
    type SerializeTupleStruct = DiffSeq<'a>;
    type SerializeMap = DiffObject<'a>;
    type SerializeStruct = DiffObject<'a>;
    type SerializeTupleVariant = DiffVariant<'a>;
    type SerializeStructVariant = DiffVariant<'a>;
    integer! {
        serialize_i8(i8); serialize_i16(i16); serialize_i32(i32); serialize_i64(i64); serialize_i128(i128);
        serialize_u8(u8); serialize_u16(u16); serialize_u32(u32); serialize_u64(u64);
    }
    fn serialize_u128(self, value: u128) -> Result<Outcome, Error> {
        match i128::try_from(value) {
            Ok(value) => self.set(Node::Int(value)),
            Err(_) => self.whole(&value),
        }
    }
    fn serialize_bool(self, value: bool) -> Result<Outcome, Error> {
        self.set(Node::Bool(value))
    }
    /// No presentation field is an `f32`; were one added, its shortest text form
    /// would differ from the `f64` this stores, so keep them out of the frame.
    fn serialize_f32(self, value: f32) -> Result<Outcome, Error> {
        self.serialize_f64(value.into())
    }
    fn serialize_f64(self, value: f64) -> Result<Outcome, Error> {
        // serde_json writes null for a non-finite float, and the client's
        // decoder then drops the field entirely.
        self.set(if value.is_finite() {
            Node::Float(value)
        } else {
            Node::Null
        })
    }
    fn serialize_char(self, value: char) -> Result<Outcome, Error> {
        self.set(Node::Text(value.to_string().into()))
    }
    fn serialize_str(self, value: &str) -> Result<Outcome, Error> {
        // Identifiers dominate the string leaves and rarely change; compare
        // before allocating a replacement.
        if matches!(&*self.shadow, Node::Text(previous) if &**previous == value) {
            return Ok(Outcome::Unchanged);
        }
        self.set(Node::Text(value.into()))
    }
    fn serialize_bytes(self, value: &[u8]) -> Result<Outcome, Error> {
        let mut items = DiffSeq::new(self);
        for byte in value {
            items.element(byte)?;
        }
        items.finish()
    }
    fn serialize_none(self) -> Result<Outcome, Error> {
        self.set(Node::Null)
    }
    fn serialize_unit(self) -> Result<Outcome, Error> {
        self.set(Node::Null)
    }
    fn serialize_unit_struct(self, _name: &'static str) -> Result<Outcome, Error> {
        self.set(Node::Null)
    }
    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
    ) -> Result<Outcome, Error> {
        self.serialize_str(variant)
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Outcome, Error> {
        value.serialize(self)
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        name: &'static str,
        value: &T,
    ) -> Result<Outcome, Error> {
        value.serialize(Diff {
            keyed: name == KEYED,
            ..self
        })
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<Outcome, Error> {
        let wrapped = serde_json::json!({ variant.to_owned(): serde_json::to_value(value)? });
        self.whole(&wrapped)
    }
    fn serialize_seq(self, _len: Option<usize>) -> Result<DiffSeq<'a>, Error> {
        Ok(DiffSeq::new(self))
    }
    fn serialize_tuple(self, _len: usize) -> Result<DiffSeq<'a>, Error> {
        Ok(DiffSeq::new(self))
    }
    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        _len: usize,
    ) -> Result<DiffSeq<'a>, Error> {
        Ok(DiffSeq::new(self))
    }
    fn serialize_map(self, _len: Option<usize>) -> Result<DiffObject<'a>, Error> {
        Ok(DiffObject::new(self))
    }
    fn serialize_struct(self, _name: &'static str, _len: usize) -> Result<DiffObject<'a>, Error> {
        Ok(DiffObject::new(self))
    }
    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        _len: usize,
    ) -> Result<DiffVariant<'a>, Error> {
        Ok(DiffVariant {
            diff: self,
            variant,
            items: Vec::new(),
            fields: serde_json::Map::new(),
        })
    }
    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        _len: usize,
    ) -> Result<DiffVariant<'a>, Error> {
        Ok(DiffVariant {
            diff: self,
            variant,
            items: Vec::new(),
            fields: serde_json::Map::new(),
        })
    }
}

impl SerializeSeq for DiffSeq<'_> {
    type Ok = Outcome;
    type Error = Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.element(value)
    }
    fn end(self) -> Result<Outcome, Error> {
        self.finish()
    }
}
impl SerializeTuple for DiffSeq<'_> {
    type Ok = Outcome;
    type Error = Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.element(value)
    }
    fn end(self) -> Result<Outcome, Error> {
        self.finish()
    }
}
impl SerializeTupleStruct for DiffSeq<'_> {
    type Ok = Outcome;
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.element(value)
    }
    fn end(self) -> Result<Outcome, Error> {
        self.finish()
    }
}
impl SerializeStruct for DiffObject<'_> {
    type Ok = Outcome;
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.field(Name::Static(key), value)
    }
    fn end(self) -> Result<Outcome, Error> {
        self.finish()
    }
}
impl SerializeMap for DiffObject<'_> {
    type Ok = Outcome;
    type Error = Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), Error> {
        let key = serde_json::to_value(key)?;
        let name = key
            .as_str()
            .ok_or_else(|| Error::custom("Frame keys must be strings"))?;
        self.pending_key = Some(Name::Owned(name.into()));
        Ok(())
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        let name = self
            .pending_key
            .take()
            .ok_or_else(|| Error::custom("Frame field value without a key"))?;
        self.field(name, value)
    }
    fn end(self) -> Result<Outcome, Error> {
        self.finish()
    }
}
impl SerializeTupleVariant for DiffVariant<'_> {
    type Ok = Outcome;
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.items.push(serde_json::to_value(value)?);
        Ok(())
    }
    fn end(mut self) -> Result<Outcome, Error> {
        let content = Value::Array(std::mem::take(&mut self.items));
        self.finish(content)
    }
}
impl SerializeStructVariant for DiffVariant<'_> {
    type Ok = Outcome;
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.fields
            .insert(key.to_owned(), serde_json::to_value(value)?);
        Ok(())
    }
    fn end(mut self) -> Result<Outcome, Error> {
        let content = Value::Object(std::mem::take(&mut self.fields));
        self.finish(content)
    }
}

/// The client's `applyFramePatch`, for tests and native harnesses: copy the
/// changed paths onto the previous frame.
pub fn apply(previous: &mut Value, patch: &Value) {
    match patch {
        Value::Object(map) if map.contains_key("value") => *previous = map["value"].clone(),
        Value::Object(map) if map.contains_key("array") => {
            if let Some(runs) = map.get("from").and_then(Value::as_array) {
                let old = std::mem::take(previous.as_array_mut().expect("array baseline"));
                let length = map["length"].as_u64().expect("keyed length") as usize;
                let mut items = vec![Value::Null; length];
                for run in runs {
                    let [at, from, count] =
                        [0, 1, 2].map(|part| run[part].as_u64().expect("keyed run") as usize);
                    items[at..at + count].clone_from_slice(&old[from..from + count]);
                }
                *previous = Value::Array(items);
            }
            let items = previous.as_array_mut().expect("array baseline");
            for change in map["array"].as_array().expect("indexed patches") {
                let index = change[0].as_u64().expect("patch index") as usize;
                apply(&mut items[index], &change[1]);
            }
        }
        Value::Object(map) if map.contains_key("object") => {
            if !previous.is_object() {
                *previous = Value::Object(serde_json::Map::new());
            }
            let fields = previous.as_object_mut().expect("object baseline");
            if let Some(removed) = map.get("removed").and_then(Value::as_array) {
                for key in removed {
                    fields.remove(key.as_str().expect("removed key"));
                }
            }
            for (key, change) in map["object"].as_object().expect("field patches") {
                let slot = fields.entry(key.clone()).or_insert(Value::Null);
                apply(slot, change);
            }
        }
        _ => *previous = patch.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    impl FrameDelta {
        fn shadow_value(&self) -> Value {
            let mut text = String::new();
            self.shadow.write(&mut text);
            serde_json::from_str(&text).expect("shadow json")
        }
    }

    /// Drive the encoder from plain values so the shapes that matter (a field
    /// turning null, an array changing length, a key disappearing or coming
    /// back out of order, a leaf changing type) are covered without a battle.
    fn roundtrip<T: Serialize>(frames: &[T]) -> Vec<Option<Value>> {
        let mut delta = FrameDelta::default();
        let mut client: Option<Value> = None;
        let mut patches = Vec::new();
        for frame in frames {
            let mut expected = serde_json::to_value(frame).expect("frame json");
            normalize(&mut expected);
            let changed = delta.encode(frame).expect("encode");
            let patch: Option<Value> =
                changed.then(|| serde_json::from_str(delta.patch()).expect("patch json"));
            patches.push(patch.clone());
            match (&mut client, patch) {
                (None, Some(patch)) => {
                    let mut value = Value::Null;
                    apply(&mut value, &patch);
                    client = Some(value);
                }
                (Some(client), Some(patch)) => apply(client, &patch),
                (Some(_), None) => {}
                (None, None) => panic!("the first frame always travels"),
            }
            assert_eq!(client.as_ref(), Some(&expected), "frame {expected}");
            assert_eq!(delta.shadow_value(), expected, "shadow tracks the client");
            // Every prefix either reached the patch or was wound back.
            assert_eq!(
                delta.ctx.pending.len(),
                delta.ctx.flushed,
                "no prefix is left dangling"
            );
        }
        patches
    }

    /// A frame with one keyed collection, as the event window and shell record travel.
    #[derive(Serialize)]
    struct Window<T> {
        tick: u64,
        #[serde(serialize_with = "keyed", bound(serialize = "T: Serialize"))]
        events: T,
    }
    #[derive(Clone, Serialize)]
    struct Event {
        sequence: u64,
        kind: String,
        at: [f64; 2],
    }
    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Record {
        shell_id: i64,
        impacts: Vec<u64>,
        outcome: &'static str,
    }
    fn windows<T: Serialize + Clone>(frames: &[T]) -> Vec<Option<Value>> {
        let frames: Vec<Window<T>> = frames
            .iter()
            .map(|events| Window {
                tick: 1,
                events: events.clone(),
            })
            .collect();
        roundtrip(&frames)
    }
    fn events(sequences: std::ops::Range<u64>) -> Vec<Event> {
        sequences
            .map(|sequence| Event {
                sequence,
                kind: format!("hit {sequence}"),
                at: [sequence as f64, 0.5],
            })
            .collect()
    }
    fn keyed_patch(patch: &Option<Value>) -> &Value {
        &patch.as_ref().expect("a patch")["object"]["events"]
    }

    /// A sliding window sends what arrived, not every element shifted one place.
    #[test]
    fn a_sliding_keyed_window_sends_only_arrivals() {
        let patches = windows(&[
            events(1..6),
            events(3..8),
            events(3..8),
            events(8..9),
            vec![],
            events(9..11),
        ]);
        let slid = keyed_patch(&patches[1]);
        assert_eq!(slid["from"], json!([[0, 2, 3]]));
        assert_eq!(slid["length"], json!(5));
        assert_eq!(
            slid["array"]
                .as_array()
                .map(|changes| changes.iter().map(|c| c[0].clone()).collect::<Vec<_>>()),
            Some(vec![json!(3), json!(4)])
        );
        assert_eq!(slid["array"][0][1]["value"]["sequence"], json!(6));
        assert!(patches[2].is_none(), "an unchanged window sends nothing");
        // With no key left to claim, an arrival patches the next unclaimed element.
        assert_eq!(keyed_patch(&patches[3])["from"], json!([[0, 0, 1]]));
        // Nothing to copy: the whole array is shorter than its elements one by one.
        assert_eq!(keyed_patch(&patches[4]), &json!({"value": []}));
        assert_eq!(keyed_patch(&patches[5])["value"][1]["sequence"], json!(10));
    }

    /// Records leave from the middle, change in place and arrive at the end.
    #[test]
    fn a_keyed_record_patches_survivors_in_place_and_copies_the_rest() {
        let record = |shell_id: i64, outcome: &'static str| Record {
            shell_id,
            impacts: vec![],
            outcome,
        };
        let patches = windows(&[
            vec![
                record(1, "flying"),
                record(2, "flying"),
                record(3, "flying"),
                record(4, "flying"),
            ],
            vec![
                record(1, "flying"),
                record(3, "stopped"),
                record(4, "flying"),
                record(5, "flying"),
            ],
            vec![
                record(1, "flying"),
                record(3, "stopped"),
                record(4, "flying"),
                record(5, "stopped"),
            ],
        ]);
        assert_eq!(
            keyed_patch(&patches[1]),
            &json!({"array": [[1, {"object": {"outcome": "stopped"}}], [3, {"value": {"shellId": 5, "impacts": [], "outcome": "flying"}}]],
                "from": [[0, 0, 1], [1, 2, 2]], "length": 4})
        );
        // Nothing moved: an ordinary element patch.
        assert_eq!(
            keyed_patch(&patches[2]),
            &json!({"array": [[3, {"object": {"outcome": "stopped"}}]]})
        );
    }

    /// Keys are only a guide: moved, repeated, missing and null elements, and a
    /// collection that changes type, all arrive exactly as the frame has them.
    #[test]
    fn keyed_collections_survive_any_order_duplicates_nulls_and_type_changes() {
        let e = |sequence: i64, v: i64| json!({"sequence": sequence, "v": v});
        windows(&[
            json!([e(1, 0), e(2, 0), e(3, 0)]),
            json!([e(3, 0), e(1, 0), e(2, 0)]),
            json!([e(3, 1), e(3, 2), e(9, 0), e(1, 0)]),
            json!([null, 1, "text", [2, 3], {"nested": {"sequence": 1}}, e(1, 0), null]),
            json!([e(1, 0), null, [2, 3], 1]),
            json!({"not": "an array"}),
            json!([e(1, 0)]),
            json!(null),
            json!([]),
            json!([null]),
            json!([null, null]),
            json!([{"sequence": null, "v": 1}, {"sequence": 1.5, "v": 2}, {"sequence": true}, {"sequence": "a"}]),
            json!([{"sequence": "a"}, {"sequence": true}, {"sequence": 1.5, "v": 3}]),
            json!([{"sequence": 1.5, "v": 3}, e(4, 4), e(5, 5)]),
            json!([e(5, 5)]),
        ]);
    }

    /// An optional that turns null still has to reach the client as a removal:
    /// the decoded frame it holds has the key, and nothing else would drop it.
    #[test]
    fn a_field_turning_null_is_removed_rather_than_left_behind() {
        let mut delta = FrameDelta::default();
        delta.encode(&json!({"deckSlot": 2, "id": "a"})).unwrap();
        assert!(delta.encode(&json!({"deckSlot": null, "id": "a"})).unwrap());
        assert_eq!(delta.patch(), "{\"object\":{},\"removed\":[\"deckSlot\"]}");
        // Once gone it stays gone, without repeating the removal.
        assert!(!delta.encode(&json!({"deckSlot": null, "id": "a"})).unwrap());
        roundtrip(&[
            json!({"planes": [{"id": "p", "deckSlot": 2, "deckPosition": [1.0, 2.0]}]}),
            json!({"planes": [{"id": "p", "deckSlot": null, "deckPosition": null}]}),
            json!({"planes": [{"id": "p", "deckSlot": 3, "deckPosition": [1.0, 2.0]}]}),
        ]);
    }

    #[test]
    fn nulls_removals_type_changes_and_lengths_survive_the_patch() {
        roundtrip(&[
            json!({"tick": 0, "a": {"x": 1.5, "gone": "here", "activeFlightLimit": null},
                "list": [1, 2, 3], "empty": [], "nil": null, "text": "one"}),
            json!({"tick": 1, "a": {"x": 1.5, "activeFlightLimit": 4}, "list": [1, 2, 3],
                "empty": [], "nil": 7, "text": "one"}),
            json!({"tick": 2, "a": {"x": 2.5, "gone": null, "activeFlightLimit": null},
                "list": [1, 9], "empty": [{"k": null}], "text": "two"}),
            json!({"tick": 3, "a": [1, 2], "list": [], "empty": [{"k": 1}], "text": 5}),
            json!({"tick": 4, "a": {"x": 0.0}, "list": [], "empty": [{"k": 1}], "text": 5}),
            json!({"tick": 4, "a": {"x": 0.0}, "list": [], "empty": [{"k": 1}], "text": 5}),
        ]);
    }

    /// A `BTreeMap` field reorders its entries as keys come and go; the cursor
    /// has to follow rather than assume the previous frame's order.
    #[test]
    fn map_entries_arriving_out_of_order_still_patch_in_place() {
        roundtrip(&[
            json!({"orders": {"b": 1, "d": 2}}),
            json!({"orders": {"a": 3, "b": 1, "c": 4, "d": 2}}),
            json!({"orders": {"b": 5, "d": 2}}),
            json!({"orders": {}}),
        ]);
    }

    #[test]
    fn an_unchanged_frame_sends_nothing_and_negative_zero_is_a_change() {
        let mut delta = FrameDelta::default();
        assert!(delta.encode(&json!({"tick": 1, "x": 0.0})).unwrap());
        assert!(!delta.encode(&json!({"tick": 1, "x": 0.0})).unwrap());
        assert_eq!(delta.patch(), "");
        assert_eq!(delta.baseline_tick(), Some(1));
        assert!(delta.encode(&json!({"tick": 1, "x": -0.0})).unwrap());
        assert_eq!(delta.patch(), "{\"object\":{\"x\":-0.0}}");
        delta.reset();
        assert!(!delta.has_baseline());
    }

    #[test]
    fn nested_arrays_of_objects_patch_only_the_element_that_moved() {
        let mut delta = FrameDelta::default();
        delta
            .encode(
                &json!({"actors": [{"id": "a", "p": [0.0, 1.0]}, {"id": "b", "p": [2.0, 3.0]}]}),
            )
            .unwrap();
        assert!(
            delta
                .encode(
                    &json!({"actors": [{"id": "a", "p": [0.0, 1.0]}, {"id": "b", "p": [2.0, 4.0]}]})
                )
                .unwrap()
        );
        assert_eq!(
            delta.patch(),
            "{\"object\":{\"actors\":{\"array\":[[1,{\"object\":{\"p\":{\"array\":[[1,4.0]]}}}]]}}}"
        );
    }
}
