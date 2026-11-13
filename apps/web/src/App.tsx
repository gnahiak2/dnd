import { navigate, useRoute } from "./lib/router";
import { Lobby } from "./screens/Lobby";
import { RoomScreen } from "./screens/RoomScreen";

export const PRODUCT = "Lanternkeep";

export const ATTRIBUTION =
  'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.';

export function Attribution() {
  return (
    <details className="text-xs text-faint">
      <summary className="cursor-pointer select-none hover:text-muted">Rules content: SRD 5.1, CC-BY-4.0</summary>
      <p data-testid="attribution" className="mt-1 max-w-3xl leading-snug">
        {ATTRIBUTION}
      </p>
    </details>
  );
}

export function App() {
  const route = useRoute();
  if (route.name === "lobby") return <Lobby />;
  // Keyed by room so moving between rooms starts from a clean connection and state.
  if (route.name === "room") return <RoomScreen key={route.roomId} roomId={route.roomId} />;
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="font-serif text-2xl">Nothing here</h1>
      <p className="mt-2 text-muted">That address does not lead anywhere.</p>
      <button type="button" className="mt-6 text-amber underline" onClick={() => navigate("/")}>
        Back to the lobby
      </button>
    </main>
  );
}
