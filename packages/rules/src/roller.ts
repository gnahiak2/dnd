/**
 * Source of randomness for the rules engine. The engine never touches a global
 * RNG: callers inject one, so the server can use a CSPRNG and tests can use a
 * seed or a script.
 */
export interface DieRoller {
  /** Returns an integer in 1..sides, uniformly distributed. */
  roll(sides: number): number;
}

/** Deterministic roller (mulberry32). Same seed, same sequence. */
export function seededRoller(seed: number): DieRoller {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { roll: (sides) => Math.floor(next() * sides) + 1 };
}

/**
 * Roller that returns the given faces in order. For tests: it fails loudly if
 * a face cannot appear on the die being rolled or the script runs out.
 */
export function scriptedRoller(faces: readonly number[]): DieRoller & { remaining(): number } {
  let i = 0;
  return {
    roll(sides) {
      const face = faces[i];
      if (face === undefined) throw new Error(`scriptedRoller: no face left for d${sides} (roll #${i + 1})`);
      if (!Number.isInteger(face) || face < 1 || face > sides) {
        throw new Error(`scriptedRoller: face ${face} is impossible on a d${sides} (roll #${i + 1})`);
      }
      i += 1;
      return face;
    },
    remaining: () => faces.length - i,
  };
}
