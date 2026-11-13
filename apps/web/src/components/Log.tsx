import type { D20Roll } from "@lanternkeep/protocol";
import { type RollResult, formatModifier } from "@lanternkeep/rules";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { type LogItem, buildLogItems } from "../lib/logItems";
import { useRoom } from "../room/context";
import { cx } from "./ui";

const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Die({ value, sides, kept }: { value: number; sides: number; kept: boolean }) {
  const crit = kept && sides === 20 && value === 20;
  const fumble = kept && sides === 20 && value === 1;
  return (
    <span
      className={cx(
        "inline-block min-w-6 rounded border px-1 text-center font-mono text-xs",
        !kept && "border-line text-faint line-through",
        kept && !crit && !fumble && "border-line bg-raised text-parchment",
        crit && "border-good bg-good/15 font-bold text-good",
        fumble && "border-danger bg-danger/15 font-bold text-danger",
      )}
      title={!kept ? "Not counted" : crit ? "Natural 20" : fumble ? "Natural 1" : undefined}
    >
      {value}
    </span>
  );
}

function RollBody({ result }: { result: RollResult }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {result.terms.map((term, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {(i > 0 || term.sign === -1) && <span className="font-mono text-xs text-faint">{term.sign === -1 ? "−" : "+"}</span>}
          {term.kind === "constant" ? (
            <span className="font-mono text-xs text-muted">{term.value}</span>
          ) : (
            term.dice.map((die, j) => <Die key={j} value={die.value} sides={term.sides} kept={die.kept} />)
          )}
        </span>
      ))}
      <span className="font-mono text-xs text-faint">=</span>
      <strong data-testid="roll-total" className="font-mono text-base text-amber">
        {result.total}
      </strong>
    </span>
  );
}

function CheckBody({ roll }: { roll: D20Roll }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {roll.d20s.map((value, i) => {
        // With two dice, only the first one equal to the natural counts.
        const kept = value === roll.natural && roll.d20s.indexOf(roll.natural) === i;
        return <Die key={i} value={value} sides={20} kept={kept} />;
      })}
      <span className="font-mono text-xs text-muted">{formatModifier(roll.modifier)}</span>
      <span className="font-mono text-xs text-faint">=</span>
      <strong data-testid="roll-total" className="font-mono text-base text-amber">
        {roll.total}
      </strong>
    </span>
  );
}

const MODE_TAG = { normal: null, advantage: "advantage", disadvantage: "disadvantage" } as const;

const Entry = memo(function Entry({ item, amDm }: { item: LogItem; amDm: boolean }) {
  const common = { "data-testid": "log-entry", "data-type": item.type, "data-seq": item.seq, title: time(item.at) };
  switch (item.kind) {
    case "narration":
      return (
        <li {...common} className="my-3 border-l-2 border-amber-dim py-0.5 pl-4">
          <span className="block text-[10px] font-semibold tracking-widest text-amber-dim uppercase">DM</span>
          <p className="max-w-[68ch] font-serif text-[16px] leading-relaxed whitespace-pre-wrap text-parchment">{item.text}</p>
        </li>
      );
    case "chat":
      return (
        <li {...common} className={cx("py-0.5", item.whisper && "text-whisper")}>
          <span className="font-semibold">{item.speaker}</span>
          {item.whisper && <span className="ml-1.5 rounded border border-whisper/40 px-1 text-[10px] tracking-wide uppercase">{item.whisper}</span>}
          <span className="text-faint">: </span>
          <span className="whitespace-pre-wrap">{item.text}</span>
        </li>
      );
    case "roll":
      return (
        <li {...common} className="my-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-panel px-2 py-1">
          <span className="font-semibold">{item.speaker}</span>
          <span className="text-muted">rolls</span>
          {item.label && <span className="text-parchment">{item.label}</span>}
          <span className="font-mono text-xs text-muted">{item.result.expression}</span>
          {MODE_TAG[item.result.mode] && <span className="text-xs text-muted">with {MODE_TAG[item.result.mode]}</span>}
          {item.secret && <span className="rounded border border-whisper/40 px-1 text-[10px] tracking-wide text-whisper uppercase">secret</span>}
          <RollBody result={item.result} />
        </li>
      );
    case "request":
      return (
        <li {...common} className="my-1 text-amber">
          {item.text}
          {amDm && item.dc !== null && <span className="ml-1.5 font-mono text-xs text-muted">DC {item.dc}</span>}
        </li>
      );
    case "check":
      return (
        <li {...common} className="my-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-panel px-2 py-1">
          <span className="font-semibold">{item.who}</span>
          <span className="text-muted">{item.what}</span>
          {MODE_TAG[item.roll.mode] && <span className="text-xs text-muted">with {MODE_TAG[item.roll.mode]}</span>}
          <CheckBody roll={item.roll} />
          {item.outcome && (
            <span data-testid="check-outcome" className={cx("text-xs font-semibold tracking-wide uppercase", item.outcome === "success" ? "text-good" : "text-danger")}>
              {item.outcome}
            </span>
          )}
          {amDm && item.dc !== null && <span className="font-mono text-xs text-muted">DC {item.dc}</span>}
        </li>
      );
    case "system":
      return (
        <li {...common} className="py-0.5 text-xs text-faint">
          {item.text}
        </li>
      );
  }
});

export function Log() {
  const { snapshot, amDm } = useRoom();
  const items = useMemo(() => buildLogItems(snapshot.log), [snapshot.log]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const lastSeq = items.at(-1)?.seq ?? 0;

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinned.current = true;
    setUnseen(false);
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el || lastSeq === 0) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [lastSeq]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-y-auto px-4 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (pinned.current) setUnseen(false);
        }}
      >
        <ol data-testid="log" aria-live="polite" aria-label="Table log" className="mx-auto max-w-3xl text-sm">
          {items.map((item) => (
            <Entry key={item.seq} item={item} amDm={amDm} />
          ))}
        </ol>
      </div>
      {unseen && (
        <button
          type="button"
          onClick={toBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-amber bg-raised px-3 py-1 text-xs text-amber shadow-lg"
        >
          New messages
        </button>
      )}
    </div>
  );
}
