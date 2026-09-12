import { test, expect, type Page } from "@playwright/test";

async function openExplorer(page: Page, mobile: boolean, list = true) {
  if (!mobile) return;
  await page.getByRole("button", { name: /Explorer les|résultats/ }).click();
  if (list) await page.getByRole("button", { name: "Agrandir vers la liste des arbres" }).click();
}

test("carte, crédits, filtres, fiche et recentrage", async ({ page, isMobile }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".cesium-map")).toHaveAttribute("data-map-state", "ready");
  await expect(page.locator(".cesium-map")).toHaveAttribute("data-plan-features", "45");
  await openExplorer(page, isMobile);
  await expect(page.locator(".tree-list-item").first()).toBeVisible();
  if (!isMobile) {
    await page.getByRole("button", { name: "Informations sur les données" }).click();
    const infoDialog = page.locator(".info-dialog");
    await expect(infoDialog).toBeVisible();
    await expect(infoDialog).toContainText("ODbL 1.0");
    await expect(infoDialog).toContainText("Axes, étang et kiosque");
    await infoDialog.getByRole("button", { name: "Fermer les informations" }).click();
    await expect(infoDialog).not.toBeVisible();
  }
  const total = await page.locator(".tree-list-item").count();
  expect(total).toBeGreaterThan(100);
  await expect(page.getByRole("button", { name: "★ Remarquables" })).toHaveCount(0);
  const search = page.getByRole("searchbox");
  await search.fill("érable");
  const filtered = await page.locator(".tree-list-item").count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total);
  await expect(page.locator(".cesium-map")).toHaveAttribute("data-visible-count", String(filtered));
  await page.getByRole("button", { name: "Effacer la recherche" }).click();
  await expect(search).toHaveValue("");
  await search.fill("érable");
  await expect(page.locator("#species-suggestions .species-option-secondary").first()).toBeVisible();
  await page.locator(".species-picker summary").click();
  const speciesSelect = page.locator(".species-picker-menu");
  const japaneseMaple = speciesSelect.locator(".species-option").filter({ hasText: "Erable du Japon" });
  await expect(japaneseMaple).toBeVisible();
  await japaneseMaple.click();
  if (isMobile) {
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await openExplorer(page, true);
  }
  await expect(search).toHaveValue("Erable du Japon");
  await page.getByLabel("Trier par").selectOption("scientific");
  await expect(page.getByLabel("Trier par")).toHaveValue("scientific");
  await expect(search).toHaveValue("Erable du Japon");
  await expect(page.locator(".tree-list-item").first()).toContainText("Acer japonicum");
  await search.fill("aucun-arbre-xyz");
  await expect(page.getByText("Aucun arbre ne correspond à ces critères.")).toBeVisible();
  await page.getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(page.locator(".tree-list-item")).toHaveCount(total);
  await page.screenshot({ path: testInfo.outputPath("explorer.png") });
  await page.locator(".tree-list-item").first().click();
  await expect(page.getByRole("heading", { name: /^Erable du Japon \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir le premier résultat Wikipédia pour Acer japonicum" })).toHaveAttribute("href", "https://fr.wikipedia.org/w/index.php?search=Acer%20japonicum");
  await expect(page.locator(".tree-detail")).toContainText("Non renseigné");
  await page.getByRole("button", { name: "Détails" }).click();
  await expect(page.locator(".coordinates")).toContainText("48.");
  if (isMobile) await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("tree.png") });
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  if (isMobile) await expect(page.getByRole("button", { name: /Explorer les|résultats/ })).toBeFocused();
  else await expect(page.locator(".tree-list-item").first()).toBeFocused();
  await page.getByRole("button", { name: "⌖ Recentrer", exact: true }).click();
  await expect(page.locator(".tree-detail")).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("panneau mobile modal, clavier et retour du focus", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Interaction propre au mobile");
  await page.goto("/");
  await expect(page.locator(".tree-list-item").first()).toBeAttached();
  await expect(page.getByRole("searchbox")).not.toBeVisible();
  await openExplorer(page, true, false);
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Explorer les|résultats/ })).toBeFocused();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.getByRole("searchbox")).toBeVisible();
});

test("la croix ferme le volet mobile, y compris au format compact", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Interaction propre au mobile");
  await page.goto("/");
  await page.getByRole("button", { name: /Explorer les|résultats/ }).click();
  await expect(page.getByRole("button", { name: "Fermer l’explorateur" })).toBeVisible();
  await page.getByRole("button", { name: "Fermer l’explorateur" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("le retour depuis une fiche mobile conserve la recherche en cours", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Interaction propre au mobile");
  await page.goto("/");
  await openExplorer(page, true);
  const search = page.getByRole("searchbox");
  await search.fill("érable");
  await page.locator(".tree-list-item").first().click();
  await page.getByRole("button", { name: "Retour à la recherche" }).click();
  await expect(page.getByRole("dialog", { name: "Explorer les arbres" })).toBeVisible();
  await expect(search).toHaveValue("érable");
});

test("un tap hors du volet mobile le ferme et rend la carte", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Interaction propre au mobile");
  await page.goto("/");
  await expect(page.locator(".cesium-map")).toHaveAttribute("data-map-state", "ready");
  await page.getByRole("button", { name: "Explorer" }).click();
  await expect(page.locator("#mobile-explorer")).toBeVisible();
  await page.mouse.click(12, 12);
  await expect(page.locator("#mobile-explorer")).not.toBeVisible();
  await expect(page.locator(".cesium-map")).toBeVisible();
});

test("erreur des données puis récupération", async ({ page, isMobile }) => {
  await page.route("**/data/arbres-rennes.geojson", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/");
  await openExplorer(page, isMobile);
  await expect(page.getByText("Les données n’ont pas pu être chargées.")).toBeVisible();
  await page.unroute("**/data/arbres-rennes.geojson");
  await page.getByRole("button", { name: "Réessayer les données" }).click();
  await expect(page.locator(".tree-list-item").first()).toBeVisible();
});

test("WebGL indisponible : les fiches restent utilisables", async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind.includes("webgl")) return null;
      return Reflect.apply(getContext, this, [kind, ...args]);
    } as typeof getContext;
  });
  await page.goto("/");
  await expect(page.getByText(/La carte 3D est indisponible/)).toBeVisible();
  await openExplorer(page, isMobile);
  await page.locator(".tree-list-item").first().click();
  await expect(page.locator(".tree-detail")).toBeVisible();
});

test("le plan vectoriel ne dépend d’aucune tuile de fond", async ({ page }) => {
  let osmTileRequest = false;
  page.on("request", (request) => { if (request.url().startsWith("https://tile.openstreetmap.org/")) osmTileRequest = true; });
  await page.goto("/");
  await expect(page.locator(".cesium-map")).toHaveAttribute("data-plan-features", "45");
  expect(osmTileRequest).toBe(false);
});

test("le Thabor expose son inventaire d’arbres limité à son emprise", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Thabor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Parc du Thabor", exact: true })).toBeVisible();
  await expect(page.locator(".cesium-map")).toHaveAttribute("data-plan-features", "312");
  await expect(page.locator(".tree-list-item")).toHaveCount(1081);
});

test("la carte reste interactive après des survols répétés", async ({ page, isMobile }) => {
  test.skip(isMobile, "Le survol concerne la souris");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator(".map-scene-loading")).toHaveAttribute("aria-hidden", "true");
  const rows = page.locator(".tree-list-row");
  for (let index = 0; index < 16; index += 1) {
    await rows.nth(index).hover();
    await page.waitForTimeout(220);
    await expect(page.locator(".cesium-map")).toHaveAttribute("data-map-state", "ready");
  }
  await page.getByRole("button", { name: "Zoomer", exact: true }).click();
  const canvas = page.locator(".cesium-map canvas");
  const before = await canvas.screenshot();
  await page.getByRole("button", { name: "Dézoomer", exact: true }).click();
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await rows.first().click();
  await expect(page.locator(".tree-detail")).toBeVisible();
  expect(errors).toEqual([]);
});
