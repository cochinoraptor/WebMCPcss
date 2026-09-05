// WebMCPcss IA-First runtime (sin dependencias)
// 1) Muestra confirmación visible tras enviar formularios IA-First.
document.querySelectorAll('form.ia-form').forEach((form) => {
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const status = form.querySelector('[data-confirmation]');
    if (status) { status.hidden = false; status.textContent = 'Enviado correctamente'; }
  });
});
// 2) Publica el mapa de herramientas para agentes que inyectan WebMCP.
fetch('/webmcp.css').then((r) => r.text()).then((css) => {
  window.__WEBMCP_CSS__ = css;
}).catch(() => {});
