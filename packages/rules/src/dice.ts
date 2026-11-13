import type { DieRoller } from "./roller";

export const ROLL_MODES = ["normal", "advantage", "disadvantage"] as const;
export type RollMode = (typeof ROLL_MODES)[number];

export const DICE_LIMITS = {
  maxExpressionLength: 100,
  maxTerms: 20,
  maxDicePerTerm: 100,
  maxSides: 1000,
  maxConstant: 100_000,
} as const;

export interface Keep {
  which: "highest" | "lowest";
  count: number;
}

export type DiceTerm =
  | { kind: "dice"; sign: 1 | -1; count: number; sides: number; keep?: Keep }
  | { kind: "constant"; sign: 1 | -1; value: number };

export interface DiceExpression {
  terms: DiceTerm[];
}

export interface DieResult {
  value: number;
  /** False when the die was dropped by keep-highest / keep-lowest or (dis)advantage. */
  kept: boolean;
}

export type RolledTerm =
  | { kind: "dice"; sign: 1 | -1; count: number; sides: number; keep?: Keep; dice: DieResult[]; subtotal: number }
  | { kind: "constant"; sign: 1 | -1; value: number; subtotal: number };

export interface RollResult {
  /** Normalized expression as written by the roller, e.g. "1d20+5". */
  expression: string;
  mode: RollMode;
  terms: RolledTerm[];
  total: number;
}

export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceError";
  }
}

const TERM_RE = /^(?:(\d*)d(\d+|%)(?:(kh|kl)(\d+))?|(\d+))$/;

/**
 * Parses dice notation: terms joined by + or -, each either a constant or
 * `NdS` with an optional keep suffix (`kh2`, `kl1`). `d%` is a d100.
 * Whitespace and case are ignored.
 */
export function parseDice(input: string): DiceExpression {
  if (input.length > DICE_LIMITS.maxExpressionLength) throw new DiceError("Dice expression is too long");
  // Spaces are fine around operators but not inside a term: "2d6 3" must not read as 2d63.
  if (/[^\s+-]\s+[^\s+-]/.test(input)) throw new DiceError("Unexpected space inside a term; join terms with + or -");
  const text = input.replace(/\s+/g, "").toLowerCase();
  if (text === "") throw new DiceError("Dice expression is empty");

  const terms: DiceTerm[] = [];
  let pos = 0;
  while (pos < text.length) {
    let sign: 1 | -1 = 1;
    const ch = text[pos];
    if (ch === "+" || ch === "-") {
      if (ch === "-") sign = -1;
      pos += 1;
    } else if (terms.length > 0) {
      throw new DiceError(`Expected + or - at position ${pos + 1}`);
    }
    let end = pos;
    while (end < text.length && text[end] !== "+" && text[end] !== "-") end += 1;
    const raw = text.slice(pos, end);
    const match = TERM_RE.exec(raw);
    if (!match) throw new DiceError(raw === "" ? "Dice expression has a dangling operator" : `Cannot read "${raw}"`);
    pos = end;

    const [, countText, sidesText, keepKind, keepText, constantText] = match;
    if (constantText !== undefined) {
      const value = Number(constantText);
      if (value > DICE_LIMITS.maxConstant) throw new DiceError(`Constant ${constantText} is too large`);
      terms.push({ kind: "constant", sign, value });
    } else {
      const count = countText === "" || countText === undefined ? 1 : Number(countText);
      const sides = sidesText === "%" ? 100 : Number(sidesText);
      if (count < 1) throw new DiceError("Must roll at least one die");
      if (count > DICE_LIMITS.maxDicePerTerm) throw new DiceError(`At most ${DICE_LIMITS.maxDicePerTerm} dice per term`);
      if (sides < 2) throw new DiceError("A die needs at least 2 sides");
      if (sides > DICE_LIMITS.maxSides) throw new DiceError(`At most ${DICE_LIMITS.maxSides} sides per die`);
      const term: DiceTerm = { kind: "dice", sign, count, sides };
      if (keepKind !== undefined) {
        const keepCount = Number(keepText);
        if (keepCount < 1 || keepCount > count) throw new DiceError(`Cannot keep ${keepText} of ${count} dice`);
        term.keep = { which: keepKind === "kh" ? "highest" : "lowest", count: keepCount };
      }
      terms.push(term);
    }
    if (terms.length > DICE_LIMITS.maxTerms) throw new DiceError(`At most ${DICE_LIMITS.maxTerms} terms`);
  }
  return { terms };
}

export function formatDice(expr: DiceExpression): string {
  return expr.terms
    .map((term, i) => {
      const sign = term.sign === -1 ? "-" : i === 0 ? "" : "+";
      if (term.kind === "constant") return `${sign}${term.value}`;
      const keep = term.keep ? `${term.keep.which === "highest" ? "kh" : "kl"}${term.keep.count}` : "";
      return `${sign}${term.count}d${term.sides}${keep}`;
    })
    .join("");
}

function markKept(values: number[], keep: Keep | undefined): DieResult[] {
  if (!keep) return values.map((value) => ({ value, kept: true }));
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => (keep.which === "highest" ? b.value - a.value : a.value - b.value) || a.index - b.index);
  const keptIndexes = new Set(order.slice(0, keep.count).map((o) => o.index));
  return values.map((value, index) => ({ value, kept: keptIndexes.has(index) }));
}

/**
 * Rolls an expression. Advantage and disadvantage apply to the expression's
 * d20: it is rolled twice and the higher (or lower) die is kept. They are only
 * meaningful for d20 tests, so the expression must contain exactly one plain
 * `1d20` term.
 */
export function rollDice(input: string | DiceExpression, roller: DieRoller, mode: RollMode = "normal"): RollResult {
  const expr = typeof input === "string" ? parseDice(input) : input;

  let d20Index = -1;
  if (mode !== "normal") {
    const candidates = expr.terms.flatMap((term, i) =>
      term.kind === "dice" && term.sides === 20 && term.count === 1 && !term.keep && term.sign === 1 ? [i] : [],
    );
    if (candidates.length !== 1) {
      throw new DiceError(`${mode === "advantage" ? "Advantage" : "Disadvantage"} needs exactly one d20 in the roll`);
    }
    d20Index = candidates[0]!;
  }

  let total = 0;
  const terms: RolledTerm[] = expr.terms.map((term, i) => {
    if (term.kind === "constant") {
      const subtotal = term.sign * term.value;
      total += subtotal;
      return { ...term, subtotal };
    }
    const twice = i === d20Index;
    const rollCount = twice ? 2 : term.count;
    const keep: Keep | undefined = twice
      ? { which: mode === "advantage" ? "highest" : "lowest", count: 1 }
      : term.keep;
    const values = Array.from({ length: rollCount }, () => {
      const value = roller.roll(term.sides);
      if (!Number.isInteger(value) || value < 1 || value > term.sides) {
        throw new Error(`DieRoller returned ${value} for a d${term.sides}`);
      }
      return value;
    });
    const dice = markKept(values, keep);
    const subtotal = term.sign * dice.reduce((sum, die) => sum + (die.kept ? die.value : 0), 0);
    total += subtotal;
    return { ...term, dice, subtotal };
  });

  return { expression: formatDice(expr), mode, terms, total };
}

/**
 * Advantage and disadvantage from several sources do not stack, and if a roll
 * has both, they cancel out no matter how many sources of each there are.
 */
export function combineRollModes(modes: readonly RollMode[]): RollMode {
  const adv = modes.includes("advantage");
  const dis = modes.includes("disadvantage");
  if (adv === dis) return "normal";
  return adv ? "advantage" : "disadvantage";
}
