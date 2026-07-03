# 11 · Paso 8 — Pass visual estilizado (V1-G)

> El salto de "escena de debug" a "parece un juego" (docs/09 §5): low-poly estilizado
> **sin Blender ni assets externos** — cielo físico, sol cálido con sombras suaves PCSS,
> materiales flat-shading, avatar con silueta de camaleón y HUD rediseñado. Todo con lo
> ya instalado (drei v10 + three); cero dependencias nuevas.

---

## Resumen

- **Cielo + luz**: `Sky` de drei (sol compartido con la `directionalLight` → sombras
  coherentes), `SoftShadows` (PCSS), luz hemisférica cielo/suelo con relleno alto **a
  propósito** (las caras en sombra de los props deben seguir leyendo su color: el color
  local es la materia prima del camuflaje). Shadow map 2048² acotado a la arena 30×30.
  Niebla re-tonada al color del horizonte (`#cfdce8`, 32→110 m).
- **Materiales/geometría**: `flatShading` en muros/props (el facetado low-poly),
  cajas con **bisel** (`RoundedBoxGeometry` de three/examples), cilindros a 12 caras,
  esferas con la teselación compartida del avatar-bola (ver abajo).
- **Horizonte decorativo**: disco de suelo exterior + anillo de colinas cónicas
  low-poly fuera del recinto. **`userData.noSample`**: el cuentagotas las ignora (no
  existen para el servidor — la coherencia color absorbido ≡ color de referencia se
  mantiene). También se excluyen trazadores y el marcador local del muestreo.
- **Avatar camaleón** ([`avatarGeometry.ts`](../apps/frontend/src/features/canvas-3d/components/avatarGeometry.ts)):
  silueta low-poly por pose construida con primitivas **fusionadas** en UNA
  `BufferGeometry` por pose (`mergeGeometries`) → `Players` sigue en 4 draw calls
  instanciados. De pie/agachado = cuerpo inclinado + cabeza con ojos-torreta + hocico +
  cola en espiral; **bola = esfera pura con la MISMA teselación que las bolas
  decorativas del mapa** (mimetismo de objeto, biblia); plano = panel. Pies en y=0
  (fuera el offset mágico `POSE_HALF_H` del render).
  - **Contrato testeado** (`avatarGeometry.test.ts`, TDD): la visual **cubre** la esfera
    de impacto del server (`POSE_BODY_CY/R`, nada de "aire que da hit") y solo la
    desborda un **fleco acotado** (`VISUAL_FRINGE` = 0.12 m: hocico/cola/patas); mira a
    +Z local (convención del yaw); la bola es casi esférica.
- **Cámara**: FOV dinámico — 75° en la primera persona del Seeker (escanear ancho),
  60° en tercera persona/vistas. Recalcula la proyección SOLO al cambiar (no por frame).
- **HUD rediseñado** (`globals.css` + `Hud.tsx`): sistema "juguete de selva" — chips
  redondeados sobre tinta verde-bosque, timer central grande con **pulso** al agotarse
  (≤10 s), badges de rol por color (Hider hoja / Seeker ámbar), retícula de cruz con
  hueco central, hit-marker con animación pop, overlay ciego del Seeker con viñeta
  radial, botones amarillo-sol con pulsación 3D. Solo presentación: los hooks (estado
  lento por selectores, countdown por `setInterval`) quedaron intactos.
- **Fix descubierto**: `globals.css` **no se importaba en ningún sitio** — ahora entra
  por `links` del head en `__root.tsx` (`?url`, lo sirve el SSR de Start sin flash).

## Verificación

- `pnpm test` (shared 7 · sim 100 · backend 23 · **frontend 24**) · `test:do` 6 ·
  `typecheck` · `lint` — todo verde. Build de producción del frontend OK.
- **Verificación visual real** (headless Chrome + playwright-core contra
  `wrangler dev` + `vite dev`, 2 pestañas = 2 jugadores): lobby aéreo, prep del Hider
  (3ª persona, barra de camuflaje, Spoid), **overlay ciego del Seeker (100% opaco)**,
  y caza (FPP 75°, retícula, timer 89s). Las capturas guiaron dos correcciones: cabeza
  del avatar embebida en el torso (adelantada) y caras en sombra demasiado oscuras
  (hemisferio 1.15).

## Decisiones y no-goals (esta pasada)

- **Sin assets `.glb` CC0 todavía**: docs/09 §5 los lista como el segundo escalón
  (Kenney/Poly Pizza/Quaternius + Draco/R2). El escalón "primitivas + dirección de
  arte" ya da el salto principal; los `.glb` quedan como mejora si el playtest los pide.
- **Placas de nombre** → van con V1-E (todavía no existen nombres reales de jugador).
- **El Seeker se ve igual que un Hider** (blanco) → diferenciarlo visualmente es
  post-playtest (el original tiñe/marca al oni).
- **Tipografía**: stack rounded del sistema (sin fuente descargable) para mantener el
  cliente autocontenido en el edge; una fuente propia empaquetada es un follow-up menor.
- El mapa sigue siendo **DATO compartido** (`MapData`): el render es libre pero cada
  malla jugable conserva `userData.refColor` y la decoración es `noSample`.

## Qué falta para cerrar V1 (ver checklist en `docs/09`)

Playtest del pass visual (el usuario) · **V1-F results/reveal** · V1-E matchmaking ·
V1-H audio · V1-I deploy.
