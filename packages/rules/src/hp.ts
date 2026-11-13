export interface HitPoints {
  current: number;
  max: number;
  temp: number;
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`Amount must be a non-negative integer, got ${amount}`);
}

/** Damage is taken from temporary hit points first; hit points never drop below 0. */
export function applyDamage(hp: HitPoints, amount: number): HitPoints {
  assertAmount(amount);
  const fromTemp = Math.min(hp.temp, amount);
  return { max: hp.max, temp: hp.temp - fromTemp, current: Math.max(0, hp.current - (amount - fromTemp)) };
}

/** Healing cannot raise hit points above the maximum and does not restore temporary hit points. */
export function applyHealing(hp: HitPoints, amount: number): HitPoints {
  assertAmount(amount);
  return { ...hp, current: Math.min(hp.max, hp.current + amount) };
}

/**
 * Temporary hit points do not stack: the new amount replaces the old one.
 * Whether to take the new amount or keep the old is the creature's choice, so
 * callers that want to keep the old amount simply do not call this.
 */
export function setTempHp(hp: HitPoints, amount: number): HitPoints {
  assertAmount(amount);
  return { ...hp, temp: amount };
}

export function setCurrentHp(hp: HitPoints, amount: number): HitPoints {
  assertAmount(amount);
  return { ...hp, current: Math.min(hp.max, amount) };
}

export const HEALTH_BANDS = ["healthy", "bloodied", "down"] as const;
/**
 * Coarse health shown to players for creatures whose exact hit points are
 * hidden. "Bloodied" (at or below half) is a table convention, not an SRD rule.
 */
export type HealthBand = (typeof HEALTH_BANDS)[number];

export function healthBand(hp: HitPoints): HealthBand {
  if (hp.current <= 0) return "down";
  return hp.current * 2 <= hp.max ? "bloodied" : "healthy";
}
