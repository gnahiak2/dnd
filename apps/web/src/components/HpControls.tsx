import type { HpChange, HpTarget } from "@lanternkeep/protocol";
import { CONDITIONS, type Condition } from "@lanternkeep/rules";
import { useState } from "react";
import { useRoom } from "../room/context";
import { Button, Check, Input, cx } from "./ui";

const label = (condition: string): string => condition.charAt(0).toUpperCase() + condition.slice(1);

/** Amount field with damage / heal (and optionally temporary hit point) buttons for one target. */
export function HpControls({ target, ids, withTemp = false }: { target: HpTarget; ids: { amount: string; damage: string; heal: string; temp?: string }; withTemp?: boolean }) {
  const { connected, send } = useRoom();
  const [amount, setAmount] = useState("");
  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= 9999;

  const apply = async (op: HpChange["op"]) => {
    if (!valid) return;
    if (await send({ type: "adjust_hp", target, change: { op, amount: value } })) setAmount("");
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        data-testid={ids.amount}
        aria-label="Hit point amount"
        type="number"
        inputMode="numeric"
        min={0}
        max={9999}
        className="w-14 py-0.5 text-center font-mono"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0"
      />
      <Button small tone="danger" data-testid={ids.damage} disabled={!connected || !valid} onClick={() => void apply("damage")}>
        Damage
      </Button>
      <Button small data-testid={ids.heal} disabled={!connected || !valid} onClick={() => void apply("heal")}>
        Heal
      </Button>
      {withTemp && ids.temp && (
        <Button small data-testid={ids.temp} disabled={!connected || !valid} onClick={() => void apply("temp")} title="Set temporary hit points">
          Temp
        </Button>
      )}
    </div>
  );
}

export function ConditionChips({ conditions }: { conditions: readonly string[] }) {
  if (conditions.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Conditions">
      {conditions.map((condition) => (
        <li key={condition} data-testid="condition-chip" className="rounded border border-whisper/40 px-1.5 text-[11px] text-whisper">
          {label(condition)}
        </li>
      ))}
    </ul>
  );
}

export function ConditionPicker({ target, active }: { target: HpTarget; active: readonly Condition[] }) {
  const { connected, send } = useRoom();
  return (
    <details className="text-xs">
      <summary data-testid="conditions-toggle" className="cursor-pointer text-muted select-none hover:text-parchment">
        Conditions
      </summary>
      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
        {CONDITIONS.map((condition) => (
          <Check
            key={condition}
            data-testid={`condition-${condition}`}
            className="text-xs"
            label={label(condition)}
            checked={active.includes(condition)}
            disabled={!connected}
            onChange={(e) => void send({ type: "set_condition", target, condition, active: e.target.checked })}
          />
        ))}
      </div>
    </details>
  );
}

export function HpBar({ current, max, temp }: { current: number; max: number; temp: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ink" role="presentation">
      <div
        className={cx("h-full rounded-full transition-[width]", current === 0 ? "bg-line" : ratio <= 0.5 ? "bg-danger" : "bg-good", temp > 0 && "ring-1 ring-whisper")}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
