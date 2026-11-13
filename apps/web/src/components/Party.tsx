import type { Character } from "@lanternkeep/protocol";
import { formatHp } from "../lib/describe";
import { useRoom } from "../room/context";
import { ConditionChips, ConditionPicker, HpBar, HpControls } from "./HpControls";
import { Panel } from "./ui";

function CharacterCard({ character }: { character: Character }) {
  const { me, amDm, playerName } = useRoom();
  const { sheet, hp } = character;
  const canEdit = amDm || character.ownerId === me;
  const target = { kind: "character" as const, characterId: character.id };
  const subtitle = [sheet.race, sheet.className && `${sheet.className} ${sheet.level}`].filter(Boolean).join(" ") || `Level ${sheet.level}`;

  return (
    <li data-testid="character-card" data-character-id={character.id} className="space-y-1.5 rounded border border-line bg-raised p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 data-testid="character-name" className="truncate font-serif text-[15px]">
            {sheet.name}
          </h3>
          <p className="truncate text-xs text-muted">
            {subtitle} <span className="text-faint">· {playerName(character.ownerId)}</span>
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-xs text-muted">
          <div>AC {sheet.armorClass}</div>
          <div>
            HP <span data-testid="hp-value" className="text-parchment">{formatHp(hp)}</span>
          </div>
        </div>
      </div>
      <HpBar {...hp} />
      <ConditionChips conditions={character.conditions} />
      {canEdit && (
        <div className="space-y-1.5 pt-0.5">
          <HpControls target={target} withTemp ids={{ amount: "hp-amount", damage: "hp-damage", heal: "hp-heal", temp: "hp-temp" }} />
          <ConditionPicker target={target} active={character.conditions} />
        </div>
      )}
    </li>
  );
}

export function Party() {
  const { state } = useRoom();
  const characters = Object.values(state.characters).sort((a, b) => a.sheet.name.localeCompare(b.sheet.name));
  return (
    <Panel title="Party">
      {characters.length === 0 ? (
        <p className="text-sm text-muted">No characters yet. Create one in the Sheet tab.</p>
      ) : (
        <ul className="space-y-2">
          {characters.map((character) => (
            <CharacterCard key={character.id} character={character} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
