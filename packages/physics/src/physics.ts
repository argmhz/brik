import RAPIER from "@dimforge/rapier2d-compat";
import {
  type App,
  type Entity,
  GlobalTransform2D,
  Parent,
  Time,
  Transform2D,
  type Vec2,
  type World,
  mat3,
} from "@brik/core";
import {
  CharacterController2D,
  Collider2D,
  CollisionEnter,
  CollisionExit,
  CollisionFilter,
  RigidBody2D,
  TriggerEnter,
  TriggerExit,
  Velocity2D,
} from "./components";

type R = typeof RAPIER;

let rapier: R | null = null;
let loading: Promise<R> | null = null;

/** Loads the Rapier WASM module. Physics does nothing until this has finished. */
export function initPhysics(): Promise<void> {
  loading ??= RAPIER.init().then(() => (rapier = RAPIER));
  return loading.then(() => {});
}

export interface PhysicsOptions {
  /** World units per second², default (0, -9.81 m/s²) in world units. */
  gravity?: Vec2;
  /** How many world units make one meter. Rapier is tuned for meter-sized objects. Default 32. */
  pixelsPerMeter?: number;
}

export interface RaycastHit {
  entity: Entity;
  point: Vec2;
  normal: Vec2;
  distance: number;
}

interface BodyEntry {
  ref: number;
  body: RAPIER.RigidBody;
  /** False for the static bodies made for colliders without a RigidBody2D. */
  explicit: boolean;
  /** Last pose written to or read from the ECS, to notice teleports from scripts. */
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  va: number;
  sig: string;
}

interface ColliderEntry {
  ref: number;
  collider: RAPIER.Collider;
  sig: string;
}

interface CharacterEntry {
  ref: number;
  controller: RAPIER.KinematicCharacterController;
  sig: string;
}

/**
 * The physics world. Available as a resource: `world.resource(Physics)`.
 * Positions, sizes and velocities are in world units; Rapier works in meters.
 */
export class Physics {
  readonly pixelsPerMeter: number;
  gravity: Vec2;
  private rw: RAPIER.World | null = null;
  private events: RAPIER.EventQueue | null = null;
  private bodies = new Map<Entity, BodyEntry>();
  private colliders = new Map<Entity, ColliderEntry>();
  private characters = new Map<Entity, CharacterEntry>();
  private byHandle = new Map<number, Entity>();

  constructor(
    private readonly world: World,
    options: PhysicsOptions = {},
  ) {
    this.pixelsPerMeter = options.pixelsPerMeter ?? 32;
    this.gravity = options.gravity ?? { x: 0, y: -9.81 * this.pixelsPerMeter };
  }

  /** True once Rapier has loaded. */
  get ready(): boolean {
    return rapier !== null;
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  /** Casts a ray and returns the first collider hit. `dir` doesn't need to be normalized. */
  raycast(origin: Vec2, dir: Vec2, maxDistance: number, opts: { mask?: number; exclude?: Entity } = {}): RaycastHit | null {
    const rw = this.rw;
    if (!rw || !rapier) return null;
    const len = Math.hypot(dir.x, dir.y);
    if (len === 0) return null;
    const ppm = this.pixelsPerMeter;
    const ray = new rapier.Ray({ x: origin.x / ppm, y: origin.y / ppm }, { x: dir.x / len, y: dir.y / len });
    const groups = opts.mask === undefined ? undefined : ((0xffff << 16) | (opts.mask & 0xffff)) >>> 0;
    const excl = opts.exclude === undefined ? undefined : this.colliders.get(opts.exclude)?.collider;
    const hit = rw.castRayAndGetNormal(ray, maxDistance / ppm, true, undefined, groups, excl);
    if (!hit) return null;
    const entity = this.byHandle.get(hit.collider.handle);
    if (entity === undefined) return null;
    const d = hit.timeOfImpact;
    return {
      entity,
      distance: d * ppm,
      point: { x: origin.x + (dir.x / len) * d * ppm, y: origin.y + (dir.y / len) * d * ppm },
      normal: { x: hit.normal.x, y: hit.normal.y },
    };
  }

  /** Entities whose colliders contain a point. */
  overlapPoint(p: Vec2): Entity[] {
    const out: Entity[] = [];
    if (!this.rw) return out;
    const ppm = this.pixelsPerMeter;
    this.rw.intersectionsWithPoint({ x: p.x / ppm, y: p.y / ppm }, (c) => {
      const e = this.byHandle.get(c.handle);
      if (e !== undefined) out.push(e);
      return true;
    });
    return out;
  }

  /**
   * Moves a CharacterController2D entity by (dx, dy) world units, sliding along
   * walls. Returns the movement that actually happened. Call it once per frame.
   */
  moveCharacter(e: Entity, dx: number, dy: number): Vec2 {
    const world = this.world;
    const T = world.store(Transform2D);
    if (!this.characters.has(e) || !this.colliders.has(e)) this.sync();
    const ch = this.characters.get(e);
    const col = this.colliders.get(e);
    if (!ch || !col || !this.rw) {
      T.position.x[e] += dx;
      T.position.y[e] += dy;
      return { x: dx, y: dy };
    }
    const ppm = this.pixelsPerMeter;
    // Dynamic bodies are left out: the kinematic body pushes them through the
    // solver instead. (Treating them as walls makes the character get stuck when
    // something lands on its head. The cost: it can't stand on loose crates yet.)
    // Flags rather than a JS predicate: a predicate callback leaves the collider
    // set borrowed inside Rapier, and the world can then never be freed.
    const flags = rapier!.QueryFilterFlags;
    ch.controller.computeColliderMovement(
      col.collider,
      { x: dx / ppm, y: dy / ppm },
      flags.EXCLUDE_DYNAMIC | flags.EXCLUDE_SENSORS,
    );
    const m = ch.controller.computedMovement();
    const mx = m.x * ppm;
    const my = m.y * ppm;
    world.store(CharacterController2D).grounded[e] = ch.controller.computedGrounded() ? 1 : 0;
    // Only set the *next* position: the step then gives the body a velocity, so it
    // pushes and carries dynamic bodies instead of teleporting into them.
    const body = this.bodies.get(e);
    if (body) {
      const bt = body.body.translation();
      body.body.setNextKinematicTranslation({ x: bt.x + m.x, y: bt.y + m.y });
    } else {
      const cur = col.collider.translation();
      col.collider.setTranslation({ x: cur.x + m.x, y: cur.y + m.y });
    }
    this.addToTransform(e, mx, my);
    if (body) {
      body.x = this.worldPos(e).x;
      body.y = this.worldPos(e).y;
    }
    return { x: mx, y: my };
  }

  /** Applies an impulse (world units × mass per second) to a dynamic body. */
  applyImpulse(e: Entity, impulse: Vec2): void {
    const b = this.bodies.get(e)?.body;
    b?.applyImpulse({ x: impulse.x / this.pixelsPerMeter, y: impulse.y / this.pixelsPerMeter }, true);
  }

  /** Mass of a body in kilograms (Rapier's units). */
  massOf(e: Entity): number {
    return this.bodies.get(e)?.body.mass() ?? 0;
  }

  /** Removes all bodies, e.g. when a new scene is loaded. */
  reset(): void {
    try {
      for (const c of this.characters.values()) this.rw?.removeCharacterController(c.controller);
      this.rw?.free();
      this.events?.free();
    } catch (err) {
      // never let cleanup break the caller (e.g. stopping play mode); worst case is a leak
      console.warn("[brik] could not free the physics world", err);
    }
    this.rw = null;
    this.events = null;
    this.bodies.clear();
    this.colliders.clear();
    this.characters.clear();
    this.byHandle.clear();
  }

  /** Advances the simulation by `dt` seconds. */
  step(dt: number): void {
    if (!this.sync()) return;
    const rw = this.rw!;
    rw.timestep = dt;
    rw.gravity = { x: this.gravity.x / this.pixelsPerMeter, y: this.gravity.y / this.pixelsPerMeter };
    rw.step(this.events!);
    this.writeBack();
    this.emitEvents();
  }

  // ---------------------------------------------------------------- sync ECS -> Rapier

  /** Creates, updates and removes Rapier objects to match the ECS. False if Rapier isn't loaded. */
  sync(): boolean {
    const R = rapier;
    if (!R) return false;
    if (!this.rw) {
      this.rw = new R.World({ x: 0, y: 0 });
      this.events = new R.EventQueue(true);
    }
    const world = this.world;
    const rw = this.rw;

    // removed colliders/bodies (or recycled entity ids)
    for (const [e, c] of this.colliders) {
      if (world.ref(e) !== c.ref || !world.has(e, Collider2D)) this.dropCollider(e);
    }
    for (const [e, b] of this.bodies) {
      const wanted = world.ref(e) === b.ref && (b.explicit ? world.has(e, RigidBody2D) : world.has(e, Collider2D) && !world.has(e, RigidBody2D));
      if (!wanted) this.dropBody(e);
    }
    for (const [e, c] of this.characters) {
      if (world.ref(e) !== c.ref || !world.has(e, CharacterController2D)) {
        rw.removeCharacterController(c.controller);
        this.characters.delete(e);
      }
    }

    const RB = world.store(RigidBody2D);
    const V = world.store(Velocity2D);

    // bodies
    for (const e of world.query([RigidBody2D, Transform2D])) {
      const character = world.has(e, CharacterController2D);
      const type = character ? "kinematic" : RB.type[e];
      const sig = `${type}`;
      let entry = this.bodies.get(e);
      if (entry && (entry.sig !== sig || !entry.explicit)) {
        this.dropBody(e);
        entry = undefined;
      }
      if (!entry) entry = this.makeBody(e, type, true, sig);
      const b = entry.body;
      b.setGravityScale(RB.gravityScale[e], false);
      b.setLinearDamping(RB.linearDamping[e]);
      b.setAngularDamping(RB.angularDamping[e]);
      if (b.isDynamic()) b.lockRotations(RB.fixedRotation[e] !== 0, false);
      b.enableCcd(RB.ccd[e] !== 0);
      this.pushPose(e, entry);
      if (world.has(e, Velocity2D) && b.isDynamic()) {
        const ppm = this.pixelsPerMeter;
        if (V.linear.x[e] !== entry.vx || V.linear.y[e] !== entry.vy) {
          b.setLinvel({ x: V.linear.x[e] / ppm, y: V.linear.y[e] / ppm }, true);
        }
        if (V.angular[e] !== entry.va) b.setAngvel(V.angular[e], true);
      }
    }

    // colliders (an entity without a body gets a static one)
    const C = world.store(Collider2D);
    const F = world.store(CollisionFilter);
    for (const e of world.query([Collider2D, Transform2D])) {
      if (!world.has(e, RigidBody2D)) {
        let entry = this.bodies.get(e);
        if (!entry) entry = this.makeBody(e, "static", false, "static");
        this.pushPose(e, entry);
      }
      const body = this.bodies.get(e)!;
      const scale = this.worldScale(e);
      const filter = world.has(e, CollisionFilter) ? `${F.group[e]}/${F.mask[e]}` : "";
      const mass = world.has(e, RigidBody2D) ? RB.mass[e] : 0;
      const sig = [
        C.shape[e],
        C.size.x[e] * scale.x,
        C.size.y[e] * scale.y,
        C.offset.x[e],
        C.offset.y[e],
        C.friction[e],
        C.restitution[e],
        C.density[e],
        C.isTrigger[e],
        filter,
        mass,
        body.body.handle,
      ].join("|");
      const existing = this.colliders.get(e);
      if (existing && existing.sig === sig) continue;
      if (existing) this.dropCollider(e);
      this.makeCollider(e, body, scale, sig, mass);
    }

    // character controllers
    const CC = world.store(CharacterController2D);
    for (const e of world.query([CharacterController2D, Collider2D])) {
      const sig = `${CC.slopeLimit[e]}|${CC.stepHeight[e]}|${CC.snapToGround[e]}|${CC.skin[e]}`;
      const existing = this.characters.get(e);
      if (existing && existing.sig === sig) continue;
      if (existing) rw.removeCharacterController(existing.controller);
      const ppm = this.pixelsPerMeter;
      const c = rw.createCharacterController(CC.skin[e] / ppm);
      c.setUp({ x: 0, y: 1 });
      c.setSlideEnabled(true);
      c.setMaxSlopeClimbAngle(CC.slopeLimit[e]);
      c.setMinSlopeSlideAngle(CC.slopeLimit[e]);
      if (CC.stepHeight[e] > 0) c.enableAutostep(CC.stepHeight[e] / ppm, 0.1, false);
      if (CC.snapToGround[e] > 0) c.enableSnapToGround(CC.snapToGround[e] / ppm);
      this.characters.set(e, { ref: world.ref(e), controller: c, sig });
    }
    return true;
  }

  private makeBody(e: Entity, type: string, explicit: boolean, sig: string): BodyEntry {
    const R = rapier!;
    const desc =
      type === "dynamic"
        ? R.RigidBodyDesc.dynamic()
        : type === "kinematic"
          ? R.RigidBodyDesc.kinematicPositionBased()
          : R.RigidBodyDesc.fixed();
    const pos = this.worldPos(e);
    const rot = this.worldRotation(e);
    const ppm = this.pixelsPerMeter;
    desc.setTranslation(pos.x / ppm, pos.y / ppm).setRotation(rot);
    const body = this.rw!.createRigidBody(desc);
    const entry: BodyEntry = { ref: this.world.ref(e), body, explicit, x: pos.x, y: pos.y, rot, vx: 0, vy: 0, va: 0, sig };
    this.bodies.set(e, entry);
    // a body replaced under existing colliders needs new colliders
    if (this.colliders.has(e)) this.dropCollider(e);
    return entry;
  }

  private makeCollider(e: Entity, body: BodyEntry, scale: Vec2, sig: string, mass: number): void {
    const R = rapier!;
    const C = this.world.store(Collider2D);
    const ppm = this.pixelsPerMeter;
    const w = Math.max(0.001, Math.abs(C.size.x[e] * scale.x) / ppm);
    const h = Math.max(0.001, Math.abs(C.size.y[e] * scale.y) / ppm);
    let desc: RAPIER.ColliderDesc;
    if (C.shape[e] === "circle") desc = R.ColliderDesc.ball(w / 2);
    else if (C.shape[e] === "capsule") {
      // vertical capsule filling the w x h box
      const r = Math.min(w, h) / 2;
      desc = R.ColliderDesc.capsule(Math.max(0, h / 2 - r), r);
    } else desc = R.ColliderDesc.cuboid(w / 2, h / 2);
    desc
      .setTranslation((C.offset.x[e] * scale.x) / ppm, (C.offset.y[e] * scale.y) / ppm)
      .setFriction(C.friction[e])
      .setRestitution(C.restitution[e])
      .setSensor(C.isTrigger[e] !== 0)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      // let triggers notice static and kinematic bodies too
      .setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED | R.ActiveCollisionTypes.KINEMATIC_KINEMATIC);
    if (mass > 0) desc.setMass(mass);
    else desc.setDensity(C.density[e]);
    if (this.world.has(e, CollisionFilter)) {
      const F = this.world.store(CollisionFilter);
      desc.setCollisionGroups((((F.group[e] & 0xffff) << 16) | (F.mask[e] & 0xffff)) >>> 0);
    }
    const collider = this.rw!.createCollider(desc, body.body);
    this.colliders.set(e, { ref: this.world.ref(e), collider, sig });
    this.byHandle.set(collider.handle, e);
  }

  private dropCollider(e: Entity): void {
    const c = this.colliders.get(e);
    if (!c) return;
    this.byHandle.delete(c.collider.handle);
    if (this.rw?.getCollider(c.collider.handle)) this.rw.removeCollider(c.collider, false);
    this.colliders.delete(e);
  }

  private dropBody(e: Entity): void {
    const b = this.bodies.get(e);
    if (!b) return;
    // removing a body removes its colliders too
    const c = this.colliders.get(e);
    if (c && c.collider.parent()?.handle === b.body.handle) {
      this.byHandle.delete(c.collider.handle);
      this.colliders.delete(e);
    }
    this.rw?.removeRigidBody(b.body);
    this.bodies.delete(e);
  }

  /** Sends the ECS pose to Rapier when it was changed from outside (scripts, kinematic bodies). */
  private pushPose(e: Entity, entry: BodyEntry): void {
    const pos = this.worldPos(e);
    const rot = this.worldRotation(e);
    if (pos.x === entry.x && pos.y === entry.y && rot === entry.rot) return;
    const ppm = this.pixelsPerMeter;
    const b = entry.body;
    if (b.isKinematic()) {
      b.setNextKinematicTranslation({ x: pos.x / ppm, y: pos.y / ppm });
      b.setNextKinematicRotation(rot);
    } else {
      b.setTranslation({ x: pos.x / ppm, y: pos.y / ppm }, true);
      b.setRotation(rot, true);
    }
    entry.x = pos.x;
    entry.y = pos.y;
    entry.rot = rot;
  }

  // ---------------------------------------------------------------- Rapier -> ECS

  private writeBack(): void {
    const world = this.world;
    const V = world.store(Velocity2D);
    const ppm = this.pixelsPerMeter;
    for (const [e, entry] of this.bodies) {
      const b = entry.body;
      if (!entry.explicit) continue;
      if (b.isDynamic() && !b.isSleeping()) {
        const t = b.translation();
        this.setWorldPose(e, t.x * ppm, t.y * ppm, b.rotation());
        const pos = this.worldPos(e);
        entry.x = pos.x;
        entry.y = pos.y;
        entry.rot = this.worldRotation(e);
      }
      if (world.has(e, Velocity2D)) {
        const lv = b.linvel();
        V.linear.x[e] = entry.vx = Math.fround(lv.x * ppm);
        V.linear.y[e] = entry.vy = Math.fround(lv.y * ppm);
        V.angular[e] = entry.va = Math.fround(b.angvel());
      }
    }
  }

  private emitEvents(): void {
    const world = this.world;
    this.events!.drainCollisionEvents((h1, h2, started) => {
      const a = this.byHandle.get(h1);
      const b = this.byHandle.get(h2);
      if (a === undefined || b === undefined) return;
      const c1 = this.rw!.getCollider(h1);
      const c2 = this.rw!.getCollider(h2);
      const trigger = (c1?.isSensor() ?? false) || (c2?.isSensor() ?? false);
      const type = trigger ? (started ? TriggerEnter : TriggerExit) : started ? CollisionEnter : CollisionExit;
      world.emit(type, { a, b });
    });
  }

  // ---------------------------------------------------------------- transforms

  /** World position. Uses the local transform for root entities so it is never a frame stale. */
  private worldPos(e: Entity): Vec2 {
    const world = this.world;
    if (!world.has(e, Parent) || !world.has(e, GlobalTransform2D)) {
      const T = world.store(Transform2D);
      return { x: T.position.x[e], y: T.position.y[e] };
    }
    const g = world.store(GlobalTransform2D).matrix;
    return { x: g.tx[e], y: g.ty[e] };
  }

  private worldRotation(e: Entity): number {
    const world = this.world;
    if (!world.has(e, Parent) || !world.has(e, GlobalTransform2D)) return world.store(Transform2D).rotation[e];
    const g = world.store(GlobalTransform2D).matrix;
    return Math.atan2(g.b[e], g.a[e]);
  }

  private worldScale(e: Entity): Vec2 {
    const world = this.world;
    if (!world.has(e, Parent) || !world.has(e, GlobalTransform2D)) {
      const T = world.store(Transform2D);
      return { x: Math.abs(T.scale.x[e]), y: Math.abs(T.scale.y[e]) };
    }
    const g = world.store(GlobalTransform2D).matrix;
    return { x: Math.hypot(g.a[e], g.b[e]), y: Math.hypot(g.c[e], g.d[e]) };
  }

  private setWorldPose(e: Entity, x: number, y: number, rot: number): void {
    const world = this.world;
    const T = world.store(Transform2D);
    const parent = world.has(e, Parent) ? world.deref(world.store(Parent).entity[e]) : -1;
    if (parent < 0 || !world.has(parent, GlobalTransform2D)) {
      T.position.x[e] = x;
      T.position.y[e] = y;
      T.rotation[e] = rot;
      return;
    }
    const g = world.store(GlobalTransform2D).matrix;
    const pm = { a: g.a[parent], b: g.b[parent], c: g.c[parent], d: g.d[parent], tx: g.tx[parent], ty: g.ty[parent] };
    const inv = mat3.invert(pm);
    if (!inv) return;
    const local = mat3.transformPoint(inv, { x, y });
    T.position.x[e] = local.x;
    T.position.y[e] = local.y;
    T.rotation[e] = rot - Math.atan2(pm.b, pm.a);
  }

  private addToTransform(e: Entity, dx: number, dy: number): void {
    const p = this.worldPos(e);
    this.setWorldPose(e, p.x + dx, p.y + dy, this.worldRotation(e));
  }
}

/** Rapier 2D physics. Steps in `fixedUpdate`. Call `await initPhysics()` first, or physics starts once it has loaded. */
export function PhysicsPlugin(options: PhysicsOptions = {}) {
  return {
    name: "brik:physics",
    build(app: App) {
      void initPhysics();
      const physics = app.world.insertResource(new Physics(app.world, options));
      app.addSystem("fixedUpdate", {
        name: "physics.step",
        run: (w: World) => physics.step(w.resource(Time).dt),
      });
    },
  };
}
