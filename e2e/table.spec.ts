import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function createRoom(page: Page, roomName: string, displayName: string): Promise<string> {
  await page.goto("/");
  await page.getByTestId("create-room-name").fill(roomName);
  await page.getByTestId("create-display-name").fill(displayName);
  await page.getByTestId("create-submit").click();
  await expect(page).toHaveURL(/\/r\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId("room-name")).toHaveText(roomName);
  await expect(page.getByTestId("connection-status").first()).toHaveAttribute("data-status", "online");
  return new URL(page.url()).pathname;
}

async function joinRoom(page: Page, roomPath: string, displayName: string): Promise<void> {
  await page.goto(roomPath);
  await page.getByTestId("join-display-name").fill(displayName);
  await page.getByTestId("join-submit").click();
  await expect(page.getByTestId("room-name")).toBeVisible();
  await expect(page.getByTestId("connection-status").first()).toHaveAttribute("data-status", "online");
}

async function createCharacter(page: Page, name: string): Promise<void> {
  await page.getByTestId("new-character").click();
  await page.getByTestId("sheet-name").fill(name);
  await page.getByTestId("sheet-submit").click();
  await expect(page.getByTestId("sheet-view")).toContainText(name);
}

async function playerPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("a DM and a player share a table: characters, checks, dice and an encounter", async ({ page, browser }) => {
  const roomName = `The Sunken Keep ${Date.now().toString(36)}`;
  const roomPath = await createRoom(page, roomName, "Dana");

  const priya = await playerPage(browser);
  await joinRoom(priya.page, roomPath, "Priya");
  try {
    await expect(page.getByTestId("player-item").filter({ hasText: "Priya" })).toHaveAttribute("data-online", "true");
    await expect(priya.page.getByTestId("player-item").filter({ hasText: "Dana" })).toHaveAttribute("data-dm", "true");

    // Both players make a character.
    await createCharacter(page, "Mira");
    await createCharacter(priya.page, "Tamsin");
    await expect(page.getByTestId("character-card").filter({ hasText: "Tamsin" })).toBeVisible();
    await expect(priya.page.getByTestId("character-card").filter({ hasText: "Mira" })).toBeVisible();

    // Narration and table talk reach both screens.
    await page.getByTestId("chat-input").fill("The door groans open.");
    await page.getByTestId("chat-send").click();
    await expect(priya.page.locator('[data-testid="log-entry"][data-type="narration"]')).toContainText("The door groans open.");

    await priya.page.getByTestId("chat-input").fill("I light a torch.");
    await priya.page.getByTestId("chat-send").click();
    await expect(page.locator('[data-testid="log-entry"][data-type="chat"]')).toContainText("I light a torch.");

    await priya.page.getByTestId("dice-quick-d20").click();
    await expect(page.locator('[data-testid="log-entry"][data-type="roll"]').last()).toContainText("Priya");
    await expect(page.getByTestId("roll-total").last()).toBeVisible();

    // The DM asks for a check; only Priya's character is prompted, and the DC stays with the DM.
    await page.getByTestId("tab-dm").click();
    await page.getByRole("checkbox", { name: /Tamsin/ }).check();
    await page.getByTestId("request-check-dc").fill("15");
    await page.getByTestId("request-check-note").fill("to spot the ambush");
    await page.getByTestId("request-check-submit").click();

    const prompt = priya.page.getByTestId("pending-check");
    await expect(prompt).toContainText("Tamsin");
    await expect(prompt).toContainText("Perception");
    await expect(prompt).toContainText("to spot the ambush");
    await expect(priya.page.locator('[data-testid="log-entry"][data-type="check_rolled"]')).toHaveCount(0);
    await prompt.getByTestId("pending-check-roll").click();

    await expect(priya.page.getByTestId("pending-check")).toHaveCount(0);
    const checkLine = priya.page.locator('[data-testid="log-entry"][data-type="check_rolled"]');
    await expect(checkLine).toContainText("Tamsin");
    await expect(checkLine).toContainText("Perception");
    await expect(checkLine.getByTestId("check-outcome")).toHaveText(/success|failure/);
    await expect(checkLine).not.toContainText("DC 15");
    await expect(page.locator('[data-testid="log-entry"][data-type="check_rolled"]')).toContainText("DC 15");

    // Initiative for both characters.
    await page.getByTestId("start-encounter").click();
    await expect(priya.page.getByTestId("join-encounter").filter({ hasText: "Tamsin" })).toBeVisible();
    await page.getByTestId("join-encounter").filter({ hasText: "Mira" }).click();
    await page.getByTestId("join-encounter").filter({ hasText: "Tamsin" }).click();
    await expect(page.getByTestId("combatant-row")).toHaveCount(2);

    // A hidden monster: the DM sees its numbers, the player only its health band.
    await page.locator("summary", { hasText: "Add monster" }).click();
    await page.getByTestId("monster-search").fill("goblin");
    await page.getByTestId("monster-result").filter({ hasText: "Goblin" }).first().click();
    await expect(page.getByTestId("monster-add")).toBeVisible();
    await page.getByTestId("monster-add").click();
    await expect(page.getByTestId("combatant-row")).toHaveCount(3);
    await expect(priya.page.getByTestId("combatant-row")).toHaveCount(3);

    const dmGoblin = page.getByTestId("combatant-row").filter({ hasText: "Goblin" });
    await expect(dmGoblin.getByTestId("combatant-hp")).toContainText("7");
    const seenGoblin = priya.page.getByTestId("combatant-row").filter({ hasText: "Goblin" });
    await expect(seenGoblin.getByTestId("combatant-band")).toHaveText("healthy");
    await expect(seenGoblin.getByTestId("combatant-hp")).toHaveCount(0);

    await page.getByTestId("next-turn").click();
    await expect(page.locator('[data-testid="combatant-row"][data-current="true"]')).toHaveCount(1);
    await expect(priya.page.locator('[data-testid="combatant-row"][data-current="true"]')).toHaveCount(1);
    await expect(page.getByTestId("encounter-round")).toHaveText("1");

    // The reference panel searches and opens SRD entries.
    await priya.page.getByTestId("tab-reference").click();
    await priya.page.getByTestId("srd-search-input").fill("fireball");
    await priya.page.getByTestId("srd-result").filter({ hasText: "Fireball" }).first().click();
    await expect(priya.page.getByTestId("srd-detail")).toHaveAttribute("data-index", "fireball");
    await expect(priya.page.getByTestId("srd-detail")).toContainText("3rd-level evocation");

    // Reloading keeps her seat and replays the room's history.
    await priya.page.reload();
    await expect(priya.page.getByTestId("room-name")).toHaveText(roomName);
    await expect(priya.page.getByTestId("log")).toContainText("The door groans open.");
    await expect(priya.page.getByTestId("join-display-name")).toHaveCount(0);
  } finally {
    await priya.context.close();
  }
});

test("the DM seat changes hands cleanly between two browsers", async ({ page, browser }) => {
  const roomName = `Ember Vault ${Date.now().toString(36)}`;
  const roomPath = await createRoom(page, roomName, "Dana");

  const priya = await playerPage(browser);
  await joinRoom(priya.page, roomPath, "Priya");
  try {
    await expect(page.getByTestId("release-dm")).toBeVisible();
    await expect(priya.page.getByTestId("release-dm")).toHaveCount(0);
    await expect(priya.page.getByTestId("tab-dm")).toHaveCount(0);

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("release-dm").click();
    await expect(page.getByTestId("claim-dm")).toBeVisible();
    await expect(priya.page.getByTestId("claim-dm")).toBeVisible();

    await priya.page.getByTestId("claim-dm").click();
    await expect(priya.page.getByTestId("release-dm")).toBeVisible();
    await expect(priya.page.getByTestId("player-item").filter({ hasText: "Priya" })).toHaveAttribute("data-dm", "true");
    await expect(page.getByTestId("release-dm")).toHaveCount(0);
    await expect(page.getByTestId("claim-dm")).toHaveCount(0);

    // The new DM gets the DM-only panel; the old one does not.
    await priya.page.getByTestId("tab-dm").click();
    await expect(priya.page.getByRole("heading", { name: "Request a check" })).toBeVisible();
    await expect(page.getByTestId("tab-dm")).toHaveCount(0);
  } finally {
    await priya.context.close();
  }
});
