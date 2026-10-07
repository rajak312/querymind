/**
 * Small, fast, deterministic PRNG (mulberry32) plus the sampling helpers the
 * dataset generators need. Every generator receives its own `Random` seeded
 * from a constant, so the sample data is byte-for-byte identical on every load.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick() called with an empty array");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Pick using relative weights. `weights` must be the same length as `items`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Approximately normal sample (Box–Muller). */
  normal(mean: number, stdDev: number): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Poisson-distributed integer (Knuth), fine for small lambdas. */
  poisson(lambda: number): number {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > limit);
    return k - 1;
  }
}

/** Format a Date as YYYY-MM-DD using UTC fields (generators work in UTC). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Format a Date as `YYYY-MM-DD HH:MM:SS` (Postgres timestamp literal, UTC). */
export function isoTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
