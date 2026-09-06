export interface HullDamageCue {
  amount: number;
  /** Absolute hull HP immediately before this group of hits. */
  fromHp: number;
  opacity: number;
}

const HOLD_SECONDS = 1;
const FADE_SECONDS = .6;

/** Presentation only. Simulation time holds feedback still while combat is paused. */
export class HullDamageFeedback {
  private hp: number;
  private fromHp: number;
  private hitTime = -Infinity;
  private time = 0;

  constructor(hp: number) { this.hp = this.fromHp = hp; }

  update(hp: number, time: number): HullDamageCue {
    hp = Math.max(0, hp);
    if (time < this.time || hp > this.hp) {
      this.fromHp = hp;
      this.hitTime = -Infinity;
    } else if (hp < this.hp) {
      // Merge a salvo into one readable number; later hits begin a fresh group.
      if (time - this.hitTime > .35) this.fromHp = this.hp;
      this.hitTime = time;
    }
    this.hp = hp;
    this.time = time;
    const opacity = Math.max(0, Math.min(1, 1 - (time - this.hitTime - HOLD_SECONDS) / FADE_SECONDS));
    return { amount: opacity > 0 ? this.fromHp - hp : 0, fromHp: opacity > 0 ? this.fromHp : hp, opacity };
  }
}
