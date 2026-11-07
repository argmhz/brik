import { system } from "../app/app";
import type { Entity } from "../ecs/entity";
import type { World } from "../ecs/world";
import { type Mat3, mat3 } from "../math";
import { Active, Children, GlobalTransform2D, Parent, Transform2D, parentOf } from "./components";

/**
 * An entity's world matrix from its Transform2D and its parents' (not from
 * GlobalTransform2D). Use it for entities that may not have been through a
 * transform pass yet: spawned this frame, or in the very first frame.
 */
export function computeWorldMatrix(world: World, e: Entity): Mat3 {
  const T = world.store(Transform2D);
  let m = world.has(e, Transform2D) ? mat3.fromTRS(T.position.x[e], T.position.y[e], T.rotation[e], T.scale.x[e], T.scale.y[e]) : mat3.identity();
  for (let p = parentOf(world, e); p >= 0 && world.has(p, Transform2D); p = parentOf(world, p)) {
    m = mat3.multiply(mat3.fromTRS(T.position.x[p], T.position.y[p], T.rotation[p], T.scale.x[p], T.scale.y[p]), m);
  }
  return m;
}

/** Computes GlobalTransform2D for every entity from the hierarchy. Runs in postUpdate. */
export const propagateTransforms = system("propagateTransforms", (world: World) => {
  const roots = world.query({ all: [Transform2D], none: [Parent] });
  const T = world.store(Transform2D);
  const G = world.store(GlobalTransform2D);
  const A = world.store(Active);
  const C = world.store(Children);
  const g = G.matrix;

  const visit = (e: Entity, parent: Mat3 | null, parentActive: boolean) => {
    // each level gets its own matrix object; the recursion would clobber a shared one
    const m = mat3.fromTRS(T.position.x[e], T.position.y[e], T.rotation[e], T.scale.x[e], T.scale.y[e]);
    if (parent) mat3.multiply(parent, m, m);
    g.a[e] = m.a;
    g.b[e] = m.b;
    g.c[e] = m.c;
    g.d[e] = m.d;
    g.tx[e] = m.tx;
    g.ty[e] = m.ty;
    const active = parentActive && (!world.has(e, Active) || A.self[e] === 1);
    G.active[e] = active ? 1 : 0;

    if (!world.has(e, Children)) return;
    const kids = C.list[e];
    for (let i = 0; i < kids.length; i++) {
      if (world.has(kids[i], Transform2D)) visit(kids[i], m, active);
    }
  };

  for (const e of roots) visit(e, null, true);
});
