# 22 · Paso 19 — Playtest r5 (headless contra producción) + pass visual

> Ronda completa con 2 clientes headless (playwright-core + Chrome) contra
> `chameleon-canvas.jzambranogarzon.workers.dev`, revisando capturas de cada
> fase. Luego la misma ronda en local con los arreglos.

## 1. Bugs encontrados jugando (todos arreglados)

| Bug | Causa | Arreglo |
|---|---|---|
| **Suelos de los cuartos invisibles**: toda la casa se veía beige; el Hider no veía el color que el servidor puntúa | Regresión del Paso 18: al pasar a geometría unitaria, el plano del suelo se escalaba con la ALTURA de la zona (0) en vez de su profundidad | `Environment.tsx`: `scale=[ancho, profundidad, 1]` |
| **Panel del lobby estirado** (media pantalla, tapaba el mapa) | `.hud-lobby` definido dos veces en `globals.css`; la segunda no anulaba `bottom`/`right` de la primera | Borrado el bloque viejo |
| **El trazador tapaba la mira** (hexágono en el centro al disparar) | Nacía en el centro de la cámara: se veía de punta | Nace en la boca del arma (`MUZZLE_OFFSET`) y converge al punto de mira |
| **Cámara del Hider dentro de muros / de su cabeza** | Tercera persona sin colisión | `clampCameraToWalls` (rayAABB contra los muros del mapa); al acercarse, la cámara SUBE a un picado |
| **El arma se metía en la pared** al pegarse a un muro | Viewmodel con depth test normal | Se dibuja después del mundo con el depth limpio |
| **404 en consola** | Sin favicon | Favicon SVG inline en `__root.tsx` |
| Fila izquierda del HUD partida en dos líneas (Hider) | Logo + rol + contador no cabían | El logo solo se muestra fuera de la ronda |

## 2. Mejoras visuales (sin dependencias nuevas)

- **Lámparas colgantes** en vez de postes desde el suelo (los postes llenaban
  pasillos de barras que el servidor no conoce). Pool de luces con **fundido** al
  reasignar y alcance 14→9 m (sin sombras, la luz cruzaba muros).
- **Sombras del sol que siguen al jugador** (±26 m en partida, ajuste a la
  rejilla de texels en espacio de luz; ±52 m en lobby/results).
- **Muebles detallados** (mesa con tablero y cajonera, archivador con cajones,
  terminal-kiosco, taburete torneado) dentro del MISMO AABB: nuevo campo
  opcional `MapZone.furniture` (solo pista de render; sin cambio de wire).
- **Zócalo + cornisa** en todos los muros (2 InstancedMesh, `noSample`).
- **Tone mapping Neutral** (antes ACES): los colores en pantalla se parecen a la
  paleta que se iguala.
- **Disparo**: fogonazo, salpicadura en el impacto, retroceso y balanceo del arma.
- **Avatares**: la pintura se extiende en ~0.2 s y el cambio de pose rebota.
- **FOV** interpolado al entrar en primera persona.
- **HUD**: botón deshabilitado visible, foco de teclado, `@media` para pantallas
  estrechas y `prefers-reduced-motion`.

## 3. Verificación

- 357 tests verdes (sim 230 · frontend 66 · backend 36 · shared 25), typecheck, lint.
- Ronda E2E local de 2 clientes sin errores de consola ni de página.
- NO verificado: `test:do`, móvil/táctil, rendimiento (FPS) con los cambios.

## 4. Pendiente (decisiones de producto / dependencias)

- Techos o luz de atardecer: hoy la casa sigue leyéndose como exterior soleado.
- Bloom + oclusión ambiental (`@react-three/postprocessing`, dependencia nueva).
- Fuente redondeada propia (woff2) e iconos SVG en vez de emojis.
- Efecto en el mundo al atrapar a un Hider; nombres sobre los jugadores.
