# game-progress.md — Paso 18: rework visual "oficina Meccha Chameleon"

## Intent (feedback del usuario tras playtest del mapa casa)

1. **BUG z-fighting**: las paredes parpadean (caras coplanarias por la fusión de
   muros en esquinas + galletas empotradas a ras de muro).
2. **Render**: PCFSoftShadowMap · ACESFilmic toneMapping, exposure 1.2.
3. **Iluminación interior**: ambiente tenue frío #223344/0.4 · direccional
   diagonal con sombras 2048 · PointLights cálidas en techos (decay 2).
4. **Materiales**: paredes mate (rough 0.8/metal 0) · suelos pulidos (rough
   0.3/metal 0.1) con reflejos sutiles (PMREM RoomEnvironment, sin assets
   externos) · castShadow/receiveShadow en todo.
5. **Props de oficina low-poly** (geometría nativa): archivadores, mesas,
   terminales — en el GENERADOR (sim) para que el servidor los conozca como
   sólidos (oclusión + camuflaje + anti-cheat).
6. **Personajes**: apariencia mejorada (ojos/crestas low-poly DENTRO del
   hitbox, compartidos con los señuelos = mimetismo intacto) · movilidad:
   maxSpeed 6→6.5 (mapa 2.2×).

## Decisiones clave

- Skills hermanos `threejs-*` NO instalados: se aplica el director + skills del
  repo (r3f-rendering: cero setState por frame; hexagonal: el mapa es DATO en
  @mecha/sim; tdd: test de no-coplanaridad primero).
- PointLights: POOL de 6 luces reasignadas por frame a las lámparas más
  cercanas a la cámara (30+ luces fijas matan el forward renderer). Lámparas
  lejanas: malla emisiva (visual).
- Reflexión de suelos: `RoomEnvironment` (módulo LOCAL de three) + PMREM →
  scene.environment sutil (0.25). Nada de HDRs externos ni GLTF.
- Props de oficina = zonas `box`/`cylinder` nuevas en `generateHousePlan`→
  `planToMapData` (sin cambios de wire ni de ZoneShape).
- Anti z-fighting: extensión de extremos de muro t/2 → t/2−0.1 (0.2) y galleta
  PROUD del muro (sobresale 0.05). Test de coplanaridad de caras como
  regresión permanente.

## Trabajo

- [x] Diagnóstico z-fighting (extensión ±0.3 coplanar con caras perpendiculares)
- [x] Test no-coplanaridad (ROJO) → fix generador (VERDE): EXT t/2−0.1,
      pushWall(axis) con CAP_EPS 0.1, cookie x+0.2/x+0.5, deplanarizeProps
- [x] BUG extra encontrado: perímetro ABIERTO (bucles de aristas no cubrían el
      borde de la rejilla) → bucles −1..COLS + test perímetro CERRADO
- [x] Props de oficina (72 en seed 1) + materiales spec en el generador (+tests)
- [x] maxSpeed 6.5 (+golden replay)
- [x] Overhaul de Environment.tsx: PCFSoft/ACES, ambiente #223344·0.4, sol 2048,
      lámparas instanciadas + pool 6 PointLights decay 2, PMREM RoomEnvironment,
      cache materiales + geometrías unitarias
- [x] avatarGeometry: ojos-bolita (de pie + agachado; tests hitbox verdes)
- [x] Suite completa (359+28) + E2E 8/8 + métricas: 60.2 FPS, 305 zonas, 0 errores
- [x] docs/21 + commit + push (CI deploy)

## Verificación final

`pnpm test` 359 verde · `test:do` 28 · typecheck · lint · E2E 8/8 ·
render-check numérico (60 FPS, WebGL2, cero console errors, semilla idéntica en
ambos clientes).

## Verificación prevista

`pnpm test` (sim: coplanaridad, props, BFS, spawn libre) · `test:do` ·
`typecheck` · `lint` · E2E 2 navegadores · render-check numérico (fps, draw
calls, errores de consola) contra dev.
