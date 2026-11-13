import { DiceError, type RollMode, parseDice } from "@lanternkeep/rules";
import { type FormEvent, useState } from "react";
import { useRoom } from "../room/context";
import { Button, Check, Input, Select } from "./ui";

const QUICK = [4, 6, 8, 10, 12, 20, 100] as const;

export function DiceBar() {
  const { amDm, connected, send } = useRoom();
  const [expression, setExpression] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<RollMode>("normal");
  const [secret, setSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roll = async (expr: string, rollMode: RollMode): Promise<boolean> => {
    const trimmedLabel = label.trim();
    const ok = await send({
      type: "roll",
      expression: expr,
      mode: rollMode,
      secret: amDm && secret,
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
    });
    if (ok) setLabel("");
    return ok;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      parseDice(expression);
    } catch (cause) {
      setError(cause instanceof DiceError ? cause.message : "Cannot read that roll.");
      return;
    }
    setError(null);
    if (await roll(expression, mode)) setExpression("");
  };

  return (
    <form onSubmit={submit} className="space-y-1.5" aria-label="Dice">
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK.map((sides) => (
          <Button
            key={sides}
            small
            data-testid={`dice-quick-d${sides}`}
            disabled={!connected}
            className="font-mono"
            // Advantage only means something on a d20.
            onClick={() => void roll(`1d${sides}`, sides === 20 ? mode : "normal")}
          >
            d{sides}
          </Button>
        ))}
        <Select data-testid="dice-mode" aria-label="Roll mode" className="ml-auto w-auto py-0.5 text-xs" value={mode} onChange={(e) => setMode(e.target.value as RollMode)}>
          <option value="normal">Normal</option>
          <option value="advantage">Advantage</option>
          <option value="disadvantage">Disadvantage</option>
        </Select>
        {amDm && <Check data-testid="dice-secret" checked={secret} onChange={(e) => setSecret(e.target.checked)} label="Secret" className="text-xs" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-testid="dice-input"
          aria-label="Dice expression"
          aria-invalid={error !== null}
          className="w-36 font-mono"
          value={expression}
          onChange={(e) => {
            setExpression(e.target.value);
            setError(null);
          }}
          placeholder="2d6+3"
          maxLength={100}
          autoComplete="off"
        />
        <Input data-testid="dice-label" aria-label="What the roll is for" className="min-w-28 flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What for? (optional)" maxLength={80} autoComplete="off" />
        <Button data-testid="dice-roll" type="submit" disabled={!connected || expression.trim() === ""}>
          Roll
        </Button>
      </div>
      {error && (
        <p data-testid="dice-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
