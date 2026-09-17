import { test, expect } from "@playwright/test";

test("localise ponctuellement et affiche la précision de la mesure", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: -1.7, latitude: 48.15, accuracy: 1000 });
  await page.goto("/");
  await expect(page.locator(".cesium-map")).toHaveAttribute("data-map-state", "ready");
  const button = page.getByRole("button", { name: "Me localiser", exact: true });
  await button.click();
  await expect(page.getByText(/Position non obtenue pour le parc. Relancez/)).toBeVisible();
  await expect(page.getByText("Vous êtes trop loin du parc affiché.")).not.toBeVisible();
  await context.setGeolocation({ longitude: -1.66, latitude: 48.112, accuracy: 8 });
  await button.click();
  await expect(page.getByText(/Précision estimée : 8 m/)).toBeVisible();
  await expect(button).toHaveClass(/is-active/);
  await context.setGeolocation({ longitude: -1.659, latitude: 48.113, accuracy: 150 });
  await button.click();
  await expect(page.getByText(/Position approximative/)).toBeVisible();
  await expect(button).toHaveClass(/is-active/);
  await page.clock.install();
  await context.setGeolocation({ longitude: -1.66, latitude: 48.112, accuracy: 5 });
  await button.click();
  await expect(page.getByText(/Précision estimée : 5 m/)).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  const notice = page.locator(".map-location-notice");
  await expect(notice).toHaveJSProperty("popover", "manual");
  await expect(notice).toHaveCSS("pointer-events", "none");
  await page.locator(".info-dialog").last().evaluate((dialog: HTMLDialogElement) => dialog.showModal());
  await expect(page.locator(".info-dialog[open]")).toBeVisible();
  await expect(notice).toBeVisible();
  expect(await notice.evaluate((element) => element.matches(":popover-open"))).toBe(true);
  // Observe expiration without waiting a full minute for the stored fix to age.
  await page.clock.fastForward(5100);
  await expect(notice).toHaveCount(0);
  await page.clock.fastForward(60_000);
  await expect(notice).toHaveCount(0);
  await expect(button).toHaveClass(/is-active/);
});
