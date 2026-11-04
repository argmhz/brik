import { system } from "../app/app";
import type { Entity } from "../ecs/entity";
import type { World } from "../ecs/world";
import { type Mat3, mat3 } from "../math";
import { Active, Children, GlobalTransform2D, Parent, Transform2D } from "./components";

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
