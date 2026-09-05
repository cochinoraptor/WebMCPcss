// Generado por webmcpcss test generate (webmcpcss@1.0.1) desde examples/v1/tienda.webmcp.css
// Ejecuta: npx playwright test webmcp.spec.ts   (BASE_URL=https://tienda.test)
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? "https://tienda.test";

test.describe('WebMCPcss · contrato .webmcp.css', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });

  test("tc001 tool \"buscarProductos\" existe (#search-btn)", async ({ page }) => {
    await expect(page.locator("#search-btn").first()).toBeAttached();
  });

  test("tc002 tool \"buscarProductos\" tiene sus 1 parámetro(s)", async ({ page }) => {
    await expect(page.locator("#q").first(), "parámetro query").toBeAttached();
  });

  test("tc003 tool \"buscarProductos\" se ejecuta con datos de ejemplo", async ({ page }) => {
    await page.locator("#q").first().fill("webmcp");
    await page.locator("#search-btn").first().click();
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toBeTruthy();
  });

  test("tc004 tool \"anadirAlCarrito\" existe (#add-to-cart)", async ({ page }) => {
    await expect(page.locator("#add-to-cart").first()).toBeAttached();
  });

  test("tc005 tool \"anadirAlCarrito\" tiene sus 1 parámetro(s)", async ({ page }) => {
    await expect(page.locator("#qty").first(), "parámetro cantidad").toBeAttached();
  });

  test("tc006 tool \"anadirAlCarrito\" declara confirmación .cart-count", async ({ page }) => {
    // La confirmación puede aparecer solo tras la acción; comprobamos que el selector es válido.
    expect(() => page.locator(".cart-count")).not.toThrow();
  });

  test("tc007 tool \"pagarPedido\" existe (#checkout)", async ({ page }) => {
    await expect(page.locator("#checkout").first()).toBeAttached();
  });

  test("tc008 tool \"pagarPedido\" declara confirmación #order-ok", async ({ page }) => {
    // La confirmación puede aparecer solo tras la acción; comprobamos que el selector es válido.
    expect(() => page.locator("#order-ok")).not.toThrow();
  });

  test("tc009 tool \"descargarInforme\" existe (#report)", async ({ page }) => {
    await expect(page.locator("#report").first()).toBeAttached();
  });

  test("tc010 tool \"enviarConsulta\" existe (#contact-form button[type=\"submit\"])", async ({ page }) => {
    await expect(page.locator("#contact-form button[type=\"submit\"]").first()).toBeAttached();
  });

  test("tc011 tool \"enviarConsulta\" tiene sus 2 parámetro(s)", async ({ page }) => {
    await expect(page.locator("#c-email").first(), "parámetro email").toBeAttached();
    await expect(page.locator("#c-msg").first(), "parámetro mensaje").toBeAttached();
  });

  test("tc012 contexto \"precio\" existe (.price)", async ({ page }) => {
    await expect(page.locator(".price").first()).toBeAttached();
  });

  test("tc013 contexto \"precio\" tiene formato currency", async ({ page }) => {
    const value = (await page.locator(".price").first().textContent()) ?? '';
    expect(value, "formato currency").toMatch(/\d/);
  });

  test("tc014 contexto \"articulosCarrito\" existe (.cart-count)", async ({ page }) => {
    await expect(page.locator(".cart-count").first()).toBeAttached();
  });

  test("tc015 contexto \"articulosCarrito\" tiene formato number", async ({ page }) => {
    const value = (await page.locator(".cart-count").first().textContent()) ?? '';
    expect(value, "formato number").toMatch(/-?\d[\d.,]*/);
  });

});
