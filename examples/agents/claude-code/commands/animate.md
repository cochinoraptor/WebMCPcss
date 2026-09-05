---
description: Aplica animaciones declarativas (webmcp-animation-*) sin romper las del sitio
---

El argumento es un archivo `.webmcp.css` con reglas `webmcp-animation-*`
(y opcionalmente una URL).

1. Valida y simula conflictos antes de animar:
   `webmcpcss validate-conflicts $ARGUMENTS --url https://tienda.example.com --json`
2. Si hay conflictos con animaciones existentes (GSAP, Framer Motion, CSS
   del sitio), explica al usuario la resolución prevista (replace / queue /
   ignore / merge) y ofrece cambiarla con `--conflict-strategy`.
3. Aplica:
   `webmcpcss animate $ARGUMENTS --url https://tienda.example.com --screenshot /tmp/webmcp-animate.png --json`
   Usa `--sandbox` si el usuario quiere aislar las animaciones en un
   shadow root y `--type css|waapi|three` para forzar motor.
4. Resume qué animaciones se aplicaron, cuáles quedaron en cola y adjunta
   la captura.
