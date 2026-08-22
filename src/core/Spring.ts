/**
 * A tiny critically-underdamped-or-looser spring, used for every "boing" in
 * the Spooky House: the eye popping out on its stalk, the mouth snapping open,
 * the whole face leaning in for a "boo!".
 *
 * A hand-tuned tween can only ever move one way; a spring naturally overshoots
 * and settles, which is what turns "the eye moves out and back" into "the eye
 * *boings*". Cheaper than it sounds — one multiply-add per frame.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(initial = 0) {
    this.value = initial;
    this.target = initial;
  }

  /** `stiffness` and `damping` are both "bigger = snappier"; tune together. */
  update(dt: number, stiffness: number, damping: number): void {
    // Sub-step so a big dt (a dropped frame) cannot make the spring blow up.
    const steps = dt > 1 / 30 ? 3 : 1;
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const force = (this.target - this.value) * stiffness - this.velocity * damping;
      this.velocity += force * stepDt;
      this.value += this.velocity * stepDt;
    }
  }

  /** True once the spring has all but stopped moving at its target. */
  get settled(): boolean {
    return Math.abs(this.target - this.value) < 0.002 && Math.abs(this.velocity) < 0.002;
  }
}
