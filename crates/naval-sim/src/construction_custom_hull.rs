//! Section-authored closed hulls. Source remains one primitive; only Rust derives solids.
use crate::{construction_geometry as cg, construction_vertex::VertexSolid, definition::*, geometry::*};

fn transform(p: &ConstructionPrimitive, t: f64, point: &ConstructionHullPoint, index: usize) -> Vec3 {
    let h = p.custom_hull.as_ref().unwrap();
    let sign = if point.x > 0. { 1. } else if point.x < 0. { -1. } else { 0. };
    let x = point.x + if index == 2 || index == 6 { sign * h.bulb * 0.38 * (-((t - 0.055) / 0.075).powi(2)).exp() } else { 0. };
    let rake = h.rake * p.size[1] * 0.6 * (0.6 - point.y).max(0.) * (-t * 30.).exp();
    let bulb = h.bulb * p.size[1] * 0.7 * (-((point.y + 0.24) / 0.17).powi(2)).exp() * (-t * 35.).exp();
    let [x, y, z] = [x * p.size[0] / 2., point.y * p.size[1], (t - 0.5) * p.size[2] + rake - bulb];
    let (s, c) = p.rotation_deg.to_radians().sin_cos();
    add(p.position, [c*x + s*z, y, -s*x + c*z])
}
fn mean(points: &[Vec3]) -> Vec3 { scale(points.iter().fold([0.;3], |a, b| add(a, *b)), 1. / points.len() as f64) }

pub fn build(p: &ConstructionPrimitive) -> Result<VertexSolid, String> {
    let h = p.custom_hull.as_ref().ok_or("Custom hull sections are missing")?;
    if h.version != 1. || !(4..=24).contains(&h.stations.len()) || !h.rake.is_finite() || !(0.0..=1.5).contains(&h.rake) || !h.bulb.is_finite() || !(0.0..=1.0).contains(&h.bulb) {
        return Err("Custom hulls need version 1, 4–24 sections and valid bow settings".into());
    }
    if h.red_paint_y.is_some_and(|y| !y.is_finite() || y.abs() > 500.) { return Err("Red paint Y must be between -500 and 500 m".into()); }
    let mut ids = std::collections::BTreeSet::new();
    for (i, s) in h.stations.iter().enumerate() {
        if s.id.is_empty() || s.id.len() > 128 || !ids.insert(&s.id) || !s.t.is_finite() || !(0.0..=1.0).contains(&s.t) || s.points.len()!=9 || s.points.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
            return Err("Each hull section needs a unique ID, nine finite points and a position from bow to stern".into());
        }
        if (i == 0 && s.t != 0.) || (i == h.stations.len()-1 && s.t != 1.) || (i > 0 && s.t-h.stations[i-1].t < 0.005) {
            return Err("Hull end sections must stay at bow and stern; keep other sections ordered and at least 0.5% apart".into());
        }
        if s.points[4].x.abs() > 1e-10 || (0..4).any(|j| s.points[j].x > 1e-10 || (s.points[j].x+s.points[8-j].x).abs()>1e-10 || (s.points[j].y-s.points[8-j].y).abs()>1e-10) || s.points[0].y-s.points[4].y<0.06 {
            return Err("Keep hull sections symmetric, on their own side of the centerline, with the deck above the keel".into());
        }
        let area: f64 = s.points.iter().enumerate().map(|(j,p)| p.x*s.points[(j+1)%9].y-s.points[(j+1)%9].x*p.y).sum();
        if area < -1e-10 || (area < 1e-10 && i > 0 && i < h.stations.len()-1) { return Err("Only a bow or stern section may taper to zero area".into()); }
    }
    let rings: Vec<Vec<Vec3>> = h.stations.iter().map(|s| s.points.iter().enumerate().map(|(i,v)| transform(p,s.t,v,i)).collect()).collect();
    if rings.iter().flatten().flatten().any(|v| !v.is_finite() || v.abs()>1000.) { return Err("Hull points must stay within 1000 m of the design origin".into()); }
    let mut cells = vec![];
    let mut faces = vec![];
    for span in 0..rings.len()-1 {
        let a=&rings[span]; let b=&rings[span+1];
        let ca=mean(a); let cb=mean(b); let center=scale(add(ca,cb),0.5);
        let mut boundary: Vec<(String, Vec<Vec3>, bool)> = vec![];
        for edge in 0..9 {
            let k=(edge+1)%9;
            let name=match edge {0..=2=>"port",3..=4=>"bottom",5..=7=>"starboard",_=>"top"};
            let tag=format!("{name}:{edge}@{}",serde_json::to_string(&[&h.stations[span].id,&h.stations[span+1].id]).unwrap());
            if (4..8).contains(&edge) {
                boundary.push((tag.clone(),vec![a[edge],a[k],b[k]],true));
                boundary.push((tag,vec![a[edge],b[k],b[edge]],true));
            } else {
                boundary.push((tag.clone(),vec![a[edge],a[k],b[edge]],true));
                boundary.push((tag,vec![a[k],b[k],b[edge]],true));
            }
            boundary.push(("bow".into(),vec![a[k],a[edge],ca],span==0));
            boundary.push(("stern".into(),vec![b[edge],b[k],cb],span==rings.len()-2));
        }
        let mut pieces=vec![];
        for (name, f, exterior) in boundary {
            if cg::area(&f)<1e-10 { continue; }
            let det=dot(sub(f[0],center),cross(sub(f[1],center),sub(f[2],center)));
            if det < -1e-7 { return Err(format!("Hull folds through itself between sections {} and {}. Reduce the twist or add a section near this transition.",span+1,span+2)); }
            if exterior { faces.push((name,f.clone())); }
            if det.abs()<1e-10 {continue;}
            let [a,b,c]=[f[0],f[1],f[2]];
            pieces.push(cg::Cell {faces:vec![f,vec![center,b,a],vec![center,c,b],vec![center,a,c]].into_iter().map(|vertices|ConvexVolumeFacesItem {vertices}).collect()});
        }
        if cg::total(&pieces).volume<1e-8 {return Err("A hull span has no enclosed volume. Only an end section may taper to zero width".into());}
        cells.extend(cg::coalesce_cells(pieces));
    }
    let index=cg::Broadphase::sized_for(&cells);
    for (i,cell) in cells.iter().enumerate() {
        for j in index.candidates(cell).into_iter().filter(|j| *j<i) {
            if cg::intersection(cell,&cells[j]).is_some_and(|c| cg::moments(&c).volume>1e-7) {return Err("Hull sections overlap. Move the crossed sections or points apart".into());}
        }
    }
    Ok(VertexSolid { cells, faces })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hull(pointed: bool) -> ConstructionPrimitive {
        let mut p:ConstructionPrimitive=serde_json::from_value(serde_json::json!({"id":"hull","kind":"custom-hull","size":[10,4,20],"position":[0,0,0],"rotationDeg":0,"customHull":{"version":1,"rake":0,"bulb":0,"stations":[]}})).unwrap();
        for i in 0..4 {let t=i as f64/3.;let w=if pointed {t}else{1.};p.custom_hull.as_mut().unwrap().stations.push(ConstructionHullStation {id:format!("s{i}"),t,points:vec![[-w,0.5],[-w,0.25],[-w,-0.25],[-w,-0.5],[0.,-0.5],[w,-0.5],[w,-0.25],[w,0.25],[w,0.5]].into_iter().map(|v|ConstructionHullPoint {x:v[0],y:v[1]}).collect()});}
        p
    }
    #[test] fn box_and_sharp_bow_displace_real_volume() {
        for (pointed, volume) in [(false,800.),(true,400.)] {let s=build(&hull(pointed)).unwrap(); assert!((cg::total(&s.cells).volume-volume).abs()<1e-7);assert!(s.faces.iter().all(|(_,p)| cg::area(p)>0.));}
    }
    #[test] fn malformed_sections_are_rejected() {
        let mut p=hull(false);p.custom_hull.as_mut().unwrap().stations[1].t=0.;assert!(build(&p).is_err());
        let mut p=hull(false);p.custom_hull.as_mut().unwrap().stations[1].points[0].x=0.3;assert!(build(&p).is_err());
        let mut p=hull(false);p.custom_hull.as_mut().unwrap().stations[2].points[2].y=f64::NAN;assert!(build(&p).is_err());
    }
}
