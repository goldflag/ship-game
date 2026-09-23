import type { Node, TextureNode } from 'three/webgpu';
import { float, max, min, vec2, vec4 } from 'three/tsl';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec4 = Node<'vec4'>;

/** A bicubic Catmull–Rom read of `map` (`size` texels) at `uv` in five bilinear reads (the four corner taps of
 * the 4 × 4 kernel dropped, weights renormalised), clamped to the range of those reads so the kernel's negative
 * lobes cannot ring around a cloud's edge. Sharper than one bilinear read: upsampling the half-resolution cloud
 * buffer or reprojecting its history every frame, bilinear reads soften the clouds a little each time. `explicit`
 * reads level 0 (compute shaders have no derivatives). */
export function catmullRom(map: TextureNode, uv: Vec2, size: Vec2, explicit = false): Vec4 {
  const position = uv.mul(size), centre = position.sub(.5).floor().add(.5), f = position.sub(centre);
  const w0 = f.mul(f.mul(f.mul(-.5).add(1)).sub(.5));
  const w1 = f.mul(f).mul(f.mul(1.5).sub(2.5)).add(1);
  const w2 = f.mul(f.mul(f.mul(-1.5).add(2)).add(.5));
  const w3 = f.mul(f).mul(f.mul(.5).sub(.5));
  const w12 = w1.add(w2), middle = centre.add(w2.div(w12)).div(size);
  const before = centre.sub(1).div(size), after = centre.add(2).div(size);
  const read = (x: Float, y: Float): Vec4 => {
    const node = explicit ? map.sample(vec2(x, y)).level(float(0)) : map.sample(vec2(x, y));
    node.updateMatrix = false;
    return (node as unknown as Vec4).toVar();
  };
  const taps: [Vec4, Float][] = [
    [read(middle.x, before.y), w12.x.mul(w0.y)],
    [read(before.x, middle.y), w0.x.mul(w12.y)],
    [read(middle.x, middle.y), w12.x.mul(w12.y)],
    [read(after.x, middle.y), w3.x.mul(w12.y)],
    [read(middle.x, after.y), w12.x.mul(w3.y)],
  ];
  let sum: Vec4 = vec4(0), weights: Float = float(0), lo: Vec4 = taps[0][0], hi: Vec4 = taps[0][0];
  for (const [value, weight] of taps) {
    sum = sum.add(value.mul(weight)); weights = weights.add(weight);
    lo = min(lo, value); hi = max(hi, value);
  }
  return sum.div(weights).clamp(lo, hi);
}

/** One bilinear read of `map` (`size` texels) at `uv` with the position inside the texel eased by a smoothstep, so the
 * interpolation flattens at texel centres and steepens between them (Quilez's "improved texture interpolation"):
 * nearly as crisp as `catmullRom` for a 2× upsample at a fifth of its reads, with no ringing to clamp. */
export function sharpBilinear(map: TextureNode, uv: Vec2, size: Vec2): Vec4 {
  const texel = uv.mul(size).sub(.5), cell = texel.floor(), f = texel.sub(cell);
  const node = map.sample(cell.add(f.mul(f).mul(f.mul(-2).add(3))).add(.5).div(size));
  node.updateMatrix = false;
  return node as unknown as Vec4;
}
