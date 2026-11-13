import { randomInt } from "node:crypto";
import type { DieRoller } from "@lanternkeep/rules";

/** The table's real dice: a CSPRNG, uniform over 1..sides. */
export const cryptoRoller: DieRoller = { roll: (sides) => randomInt(1, sides + 1) };
