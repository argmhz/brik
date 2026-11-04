/** Frame timing. Available as a resource: `world.resource(Time)`. */
export class Time {
  /**
   * Seconds since last frame, scaled by `timeScale`. Inside `fixedUpdate`
   * systems this is the fixed step instead.
   */
  dt = 0;
  /** Seconds since last frame, ignoring `timeScale`. */
  unscaledDt = 0;
  /** Scaled seconds since the app started. */
  elapsed = 0;
  /** Frames since the app started. */
  frame = 0;
  /** Seconds per fixed step. */
  fixedDt = 1 / 60;
  /**
   * How far we are between two fixed steps (0..1). Use it to interpolate
   * rendering of objects moved in `fixedUpdate`.
   */
  alpha = 0;
  /** 0 pauses, 0.5 is slow motion. */
  timeScale = 1;
  /** Frames longer than this are clamped, so a stalled tab doesn't explode physics. */
  maxDt = 0.25;
  /** Upper limit for fixed steps per frame. */
  maxFixedSteps = 8;
  /** True while fixedUpdate systems run. */
  inFixedUpdate = false;
}
