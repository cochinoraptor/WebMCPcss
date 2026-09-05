// Generado por webmcpcss test generate (webmcpcss@1.2.1) desde examples/v1/tienda.webmcp.css
// Ejecuta: npx cypress run --spec webmcp.cy.js   (CYPRESS_BASE_URL=https://tienda.test)
const BASE_URL = Cypress.env('BASE_URL') || "https://tienda.test";

describe('WebMCPcss · contrato .webmcp.css', () => {
  beforeEach(() => {
    cy.visit(BASE_URL);
  });

  it("tc001 tool \"buscarProductos\" existe (#search-btn)", () => {
    cy.get("#search-btn").should('exist');
  });

  it("tc002 tool \"buscarProductos\" tiene sus 1 parámetro(s)", () => {
    cy.get("#q").should('exist');
  });

  it("tc003 tool \"anadirAlCarrito\" existe (#add-to-cart)", () => {
    cy.get("#add-to-cart").should('exist');
  });

  it("tc004 tool \"anadirAlCarrito\" tiene sus 1 parámetro(s)", () => {
    cy.get("#qty").should('exist');
  });

  it("tc005 tool \"anadirAlCarrito\" declara confirmación .cart-count", () => {
    cy.document().then((doc) => expect(() => doc.querySelector(".cart-count")).not.to.throw());
  });

  it("tc006 tool \"pagarPedido\" existe (#checkout)", () => {
    cy.get("#checkout").should('exist');
  });

  it("tc007 tool \"pagarPedido\" declara confirmación #order-ok", () => {
    cy.document().then((doc) => expect(() => doc.querySelector("#order-ok")).not.to.throw());
  });

  it("tc008 tool \"descargarInforme\" existe (#report)", () => {
    cy.get("#report").should('exist');
  });

  it("tc009 tool \"enviarConsulta\" existe (#contact-form button[type=\"submit\"])", () => {
    cy.get("#contact-form button[type=\"submit\"]").should('exist');
  });

  it("tc010 tool \"enviarConsulta\" tiene sus 2 parámetro(s)", () => {
    cy.get("#c-email").should('exist');
    cy.get("#c-msg").should('exist');
  });

  it("tc011 contexto \"precio\" existe (.price)", () => {
    cy.get(".price").should('exist');
  });

  it("tc012 contexto \"precio\" tiene formato currency", () => {
    cy.get(".price").first().invoke('text').should('match', /\d/);
  });

  it("tc013 contexto \"articulosCarrito\" existe (.cart-count)", () => {
    cy.get(".cart-count").should('exist');
  });

  it("tc014 contexto \"articulosCarrito\" tiene formato number", () => {
    cy.get(".cart-count").first().invoke('text').should('match', /-?\d[\d.,]*/);
  });

});
