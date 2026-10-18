import { expect, signUp, test, waitSaved } from "./helpers.ts";

test("designer: properties, JSON tab, undo, persistence and keyboard reorder are views of one definition", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "New form" }).click();
  await page.waitForURL(/\/app\/forms\/[^/]+\/design$/);
  const formId = page.url().match(/forms\/([^/]+)\/design/)![1];
  const fields = page.locator("[data-designer-field]");
  await expect(fields).toHaveCount(2);
  await expect(page.locator("#designer-title")).toHaveValue("Untitled form");

  const definition = async () => (await (await page.request.get(`/api/v1/forms/${formId}`)).json()).definition;

  // 1. Edit a label in the properties panel: the card and the JSON tab follow.
  await page.locator("#field-name").click();
  await page.locator("#prop-title").fill("Full legal name");
  await expect(page.locator("#field-name")).toContainText("Full legal name");
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(page.locator("#designer-json")).toHaveValue(/Full legal name/);
  expect(JSON.parse(await page.locator("#designer-json").inputValue()).schema.properties.name.title).toBe("Full legal name");

  // 2. Edit the JSON: the title input updates.
  const json = JSON.parse(await page.locator("#designer-json").inputValue());
  json.schema.title = "Round trip form";
  await page.locator("#designer-json").fill(JSON.stringify(json, null, 2));
  await expect(page.locator("#designer-title")).toHaveValue("Round trip form");
  await expect(page.getByText(/Not valid JSON/)).toHaveCount(0);

  // 3. Undo (focus outside the inputs first): the title goes back, the label edit stays; redo restores it.
  await page.getByRole("tab", { name: "Build" }).click();
  await page.locator("[data-designer-section]").first().click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator("#designer-title")).toHaveValue("Untitled form");
  await expect(page.locator("#field-name")).toContainText("Full legal name");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("#designer-title")).toHaveValue("Round trip form");

  // 4. It autosaves; the API agrees, and so does a reload.
  await waitSaved(page);
  const saved = await definition();
  expect(saved.schema.title).toBe("Round trip form");
  expect(saved.schema.properties.name.title).toBe("Full legal name");
  await page.reload();
  await expect(fields).toHaveCount(2);
  await expect(page.locator("#designer-title")).toHaveValue("Round trip form");
  await expect(page.locator("#field-name")).toContainText("Full legal name");

  // 5. Keyboard reorder: focus a card, Alt+ArrowDown moves it after the next one.
  expect(Object.keys((await definition()).schema.properties)).toEqual(["name", "email"]);
  await page.locator("#field-name").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(fields.first()).toContainText("Email");
  await waitSaved(page);
  await expect.poll(async () => Object.keys((await definition()).schema.properties)).toEqual(["email", "name"]);
  // ... and back up again.
  await expect(page.locator("#field-name")).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(async () => Object.keys((await definition()).schema.properties)).toEqual(["name", "email"]);
});
