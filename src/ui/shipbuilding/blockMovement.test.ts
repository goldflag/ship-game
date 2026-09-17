import { expect, test } from 'bun:test';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { blockMoveConstraint } from './blockMovement';

const block = (id: string, position: Vec3, size: Vec3 = [2, 2, 2], rotationDeg = 0): ConstructionPrimitive => ({ id, kind: 'box', position, size, rotationDeg });
const move = (primitives: ConstructionPrimitive[], delta: Vec3, ids = ['a']) =>
  blockMoveConstraint({ construction: { primitives } } as ConstructionSource, new Set(ids))(delta);
const near = (actual: Vec3, expected: Vec3) => actual.forEach((v, k) => expect(v).toBeCloseTo(expected[k], 6));

test('a block stops flush at its neighbor, even when a fast move would pass right through it', () => {
  const parts = [block('a', [0, 0, 0]), block('b', [5, 0, 0])];
  near(move(parts, [20, 0, 0]), [3, 0, 0]);
  near(move(parts, [3, 0, 0]), [3, 0, 0]);
  near(move(parts, [-20, 0, 0]), [-20, 0, 0]);
});

test('touching permits tangent motion and separation but blocks penetration on all axes', () => {
  for (let k = 0; k < 3; k++) {
    const p: Vec3 = [0, 0, 0]; p[k] = 2;
    const parts = [block('a', [0, 0, 0]), block('b', p)];
    near(move(parts, p), [0, 0, 0]);
    near(move(parts, p.map(v => -v) as Vec3), p.map(v => -v) as Vec3);
    const tangent: Vec3 = [0, 0, 0]; tangent[(k + 1) % 3] = 4;
    near(move(parts, tangent), tangent);
  }
});

test('a rigid selection ignores its own blocks and stops every member together', () => {
  const parts = [block('a', [0, 0, 0]), block('b', [2, 0, 0]), block('c', [7, 0, 0])];
  near(move(parts, [10, 0, 0], ['a', 'b']), [3, 0, 0]);
  near(move(parts, [10, 2, 0], ['a', 'b', 'c']), [10, 2, 0]);
});

test('clearance uses rotation and actual freeform corner extents', () => {
  near(move([block('a', [0, 0, 0], [6, 2, 2], 90), block('b', [5, 0, 0])], [10, 0, 0]), [3, 0, 0]);
  const freeform = block('a', [0, 0, 0]); freeform.kind = 'vertex';
  freeform.vertices = [[-.5,-.5,-.5],[1,-.5,-.5],[1,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[1,-.5,.5],[1,.5,.5],[-.5,.5,.5]];
  near(move([freeform, block('b', [5, 0, 0])], [10, 0, 0]), [2, 0, 0]);
  near(move([block('a', [0, 0, 0], [2, 2, 2], 45), block('b', [5, 0, 0])], [10, 0, 0]), [4 - Math.SQRT2, 0, 0]);
});

test('diagonal moves stop at first contact, with no false collision at a grazed corner', () => {
  near(move([block('a', [0, 0, 0]), block('b', [5, 2, 0])], [10, 2, 0]), [3, .6, 0]);
  near(move([block('a', [0, 0, 0]), block('b', [4, 0, 0])], [4, 4, 0]), [4, 4, 0]);
});

test('an existing overlap can be moved out but cannot be made deeper', () => {
  const parts = [block('a', [0, 0, 0]), block('b', [1.5, 0, 0])];
  near(move(parts, [-1, 0, 0]), [-1, 0, 0]);
  near(move(parts, [1, 0, 0]), [0, 0, 0]);
  // Contained/duplicate blocks can also be rescued.
  near(move([block('a', [0,0,0]), block('b', [0,0,0])], [0, 3, 0]), [0, 3, 0]);
});

test('unselected hull does not impede fitting-only moves; non-finite input is rejected', () => {
  near(move([block('a', [0,0,0])], [1, 2, 3], ['fitting']), [1, 2, 3]);
  near(move([block('a', [0,0,0])], [NaN, 0, 0]), [0, 0, 0]);
});
