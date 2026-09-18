//! Lossless derived ShipDefinition encoding. Direct serde traversal of the indexed
//! DAG avoids building a second serde_json::Value tree. See runtimeEncoding.ts.
use serde::{de::{self,DeserializeSeed,Visitor,SeqAccess,MapAccess,IntoDeserializer},Deserialize};
type Error=de::value::Error;
fn invalid(s:&str)->Error{de::Error::custom(s)}
fn uint(bytes:&[u8],at:&mut usize)->Result<usize,Error>{let mut n=0u64;for shift in (0..35).step_by(7){let b=*bytes.get(*at).ok_or_else(||invalid("Truncated runtime index"))?;*at+=1;n|=((b&127)as u64)<<shift;if b&128==0&&n<=u32::MAX as u64{return Ok(n as usize)}}Err(invalid("Invalid runtime index"))}
struct Graph<'a>{bytes:&'a[u8],offsets:Vec<usize>}
impl<'a> Graph<'a>{
 fn read(bytes:&'a[u8])->Result<(Self,usize),Error>{
  if bytes.get(..4)!=Some(b"NSD\x01"){return Err(invalid("Unsupported runtime encoding"))}let mut at=4;let count=uint(bytes,&mut at)?;let root=uint(bytes,&mut at)?;
  if count==0||count>8_000_000||count>bytes.len()||root>=count{return Err(invalid("Invalid runtime node count"))}
  let mut graph=Self{bytes,offsets:Vec::with_capacity(count)};let mut depths:Vec<u8>=Vec::with_capacity(count);
  for i in 0..count {graph.offsets.push(at);let tag=*bytes.get(at).ok_or_else(||invalid("Truncated runtime node"))?;at+=1;let mut depth=0u8;
   let mut reference=|at:&mut usize|->Result<usize,Error>{let r=uint(bytes,at)?;if r>=i{return Err(invalid("Invalid runtime reference"))}depth=depth.max(depths[r].checked_add(1).ok_or_else(||invalid("Runtime depth"))?);Ok(r)};
   match tag {
    0..=2=>{},
    3=>{let data=bytes.get(at..at+8).ok_or_else(||invalid("Truncated runtime number"))?;if !f64::from_le_bytes(data.try_into().unwrap()).is_finite(){return Err(invalid("Nonfinite runtime number"))}at+=8;},
    4=>{let n=uint(bytes,&mut at)?;std::str::from_utf8(bytes.get(at..at+n).ok_or_else(||invalid("Truncated runtime string"))?).map_err(|_|invalid("Invalid runtime UTF-8"))?;at+=n;},
    5=>{let n=uint(bytes,&mut at)?;if n>bytes.len()-at{return Err(invalid("Runtime array size"))}for _ in 0..n{reference(&mut at)?;}},
    6=>{let schema=reference(&mut at)?;let mut pos=graph.offsets[schema];if bytes[pos]!=5{return Err(invalid("Invalid runtime schema"))}pos+=1;let n=uint(bytes,&mut pos)?;let mut keys=std::collections::BTreeSet::new();for _ in 0..n{let key=uint(bytes,&mut pos)?;let key=graph.string(key)?;if !keys.insert(key){return Err(invalid("Duplicate runtime field"))}reference(&mut at)?;}},
    _=>return Err(invalid("Unknown runtime node")),
   }
   if depth>128{return Err(invalid("Runtime nesting exceeds limit"))}depths.push(depth);
  }
  if at!=bytes.len(){return Err(invalid("Trailing runtime data"))}Ok((graph,root))
 }
 fn string(&self,id:usize)->Result<&'a str,Error>{let mut at=self.offsets[id];if self.bytes[at]!=4{return Err(invalid("Invalid runtime field name"))}at+=1;let len=uint(self.bytes,&mut at)?;std::str::from_utf8(&self.bytes[at..at+len]).map_err(|_|invalid("Invalid runtime UTF-8"))}
}
#[derive(Clone,Copy)]struct Node<'g,'a>{graph:&'g Graph<'a>,id:usize}
struct Sequence<'g,'a>{graph:&'g Graph<'a>,at:usize,left:usize}
impl<'de,'g> SeqAccess<'de> for Sequence<'g,'de>{type Error=Error;fn next_element_seed<T:DeserializeSeed<'de>>(&mut self,seed:T)->Result<Option<T::Value>,Error>{if self.left==0{return Ok(None)}self.left-=1;let id=uint(self.graph.bytes,&mut self.at)?;seed.deserialize(Node{graph:self.graph,id}).map(Some)}fn size_hint(&self)->Option<usize>{Some(self.left)}}
struct Object<'g,'a>{keys:Sequence<'g,'a>,values:Sequence<'g,'a>}
impl<'de,'g> MapAccess<'de> for Object<'g,'de>{type Error=Error;fn next_key_seed<K:DeserializeSeed<'de>>(&mut self,seed:K)->Result<Option<K::Value>,Error>{self.keys.next_element_seed(seed)}fn next_value_seed<V:DeserializeSeed<'de>>(&mut self,seed:V)->Result<V::Value,Error>{self.values.next_element_seed(seed)?.ok_or_else(||invalid("Missing runtime value"))}fn size_hint(&self)->Option<usize>{Some(self.keys.left)}}
impl<'de,'g> de::Deserializer<'de> for Node<'g,'de>{type Error=Error;
 fn deserialize_any<V:Visitor<'de>>(self,v:V)->Result<V::Value,Error>{let b=self.graph.bytes;let mut at=self.graph.offsets[self.id];let tag=b[at];at+=1;match tag {
  0=>v.visit_unit(),1=>v.visit_bool(false),2=>v.visit_bool(true),3=>v.visit_f64(f64::from_le_bytes(b[at..at+8].try_into().unwrap())),4=>v.visit_borrowed_str(self.graph.string(self.id)?),
  5=>{let left=uint(b,&mut at)?;v.visit_seq(Sequence{graph:self.graph,at,left})},
  6=>{let schema=uint(b,&mut at)?;let mut keys=self.graph.offsets[schema]+1;let left=uint(b,&mut keys)?;v.visit_map(Object{keys:Sequence{graph:self.graph,at:keys,left},values:Sequence{graph:self.graph,at,left}})},_=>Err(invalid("Invalid runtime node"))}}
 fn deserialize_option<V:Visitor<'de>>(self,v:V)->Result<V::Value,Error>{if self.graph.bytes[self.graph.offsets[self.id]]==0{v.visit_none()}else{v.visit_some(self)}}
 fn deserialize_enum<V:Visitor<'de>>(self,_:&'static str,_:&'static[&'static str],v:V)->Result<V::Value,Error>{v.visit_enum(self.graph.string(self.id)?.into_deserializer())}
 fn deserialize_newtype_struct<V:Visitor<'de>>(self,_:&'static str,v:V)->Result<V::Value,Error>{v.visit_newtype_struct(self)}
 fn deserialize_u32<V:Visitor<'de>>(self,v:V)->Result<V::Value,Error>{
  let at=self.graph.offsets[self.id];
  if self.graph.bytes[at]!=3{return self.deserialize_any(v)}
  let n=f64::from_le_bytes(self.graph.bytes[at+1..at+9].try_into().unwrap());
  // NSD numbers are doubles, including typed construction wall versions.
  // Convert only exact in-range integers; preserve f64 fields unchanged.
  if n.fract()!=0. || n<0. || n>u32::MAX as f64{return Err(invalid("Runtime number is not an exact u32"))}
  v.visit_u32(n as u32)
 }
 serde::forward_to_deserialize_any!{bool i8 i16 i32 i64 u8 u16 u64 f32 f64 char str string bytes byte_buf unit unit_struct seq tuple tuple_struct map struct identifier ignored_any}
}
pub fn decode<T:for<'a>Deserialize<'a>>(bytes:&[u8])->Result<T,String>{let (graph,id)=Graph::read(bytes).map_err(|e|e.to_string())?;T::deserialize(Node{graph:&graph,id}).map_err(|e|e.to_string())}
