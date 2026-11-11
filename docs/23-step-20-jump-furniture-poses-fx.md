# 23 · Paso 20 — Salto, poses de mueble, Seekers a elección y salto gráfico (playtest r6)

> Feedback del usuario: "que los Hider se puedan convertir en todas las figuras del
> mapa", "que los personajes puedan saltar con espacio… y el Seeker mucho más alto
> para ver el mapa", "que el host elija cuántos buscan y cuántos se esconden", y
> "gráficos mucho mejores".

## 1. Salto (sim compartido, predicho por el cliente)

- `PlayerState` gana `vy`, `grounded` (y `lastVertTick`, solo servidor).
- `applyVertical` (`@mecha/sim/core/movement`): impulso si está apoyado, gravedad,
  aterrizaje. Se ejecuta **una vez por comando** en servidor y cliente (misma
  función ⇒ la predicción converge). La gravedad corre aunque el jugador no pueda
  moverse: un Hider congelado en el aire al empezar la caza cae.
- **Muebles pisables**: con los pies a la altura del tope de un `prop`, este deja de
  colisionar en horizontal y pasa a ser suelo (`groundHeightAt`). Los **muros nunca**
  son pisables: ni el salto del Seeker cruza la casa por encima.
- Config: `gravity 20`, `jumpSpeed 7.2` (Hider ≈1.3 m: mesas, taburetes, cajas),
  `seekerJumpSpeed 12` (≈3.6 m: ojos a >5 m, ve por encima de los muros de 3 m).
  `bounds.maxY` 5→6.
- Jugadores que dejan de mandar comandos en el aire: el servidor integra su caída
  tras 10 ticks (no antes, para no duplicar la gravedad de los activos con jitter).

## 2. Poses de mueble (10 poses)

- `POSE_CABINET/DESK/TERMINAL/STOOL` (6..9). Medidas = `FURNITURE_SPECS`
  (exportado de `MapData`): la pose mide exactamente lo que el mueble del mapa.
- `furnitureGeometry.ts`: ÚNICA definición de la forma de cada mueble, usada por
  `Environment` (escalada al AABB de la zona) y por `avatarGeometry` (poses).
- Material por pose: las de mueble copian roughness/metalness/flat del mueble.
- Hitbox: esfera por pose. La mesa (1.6 m, baja) cubre el centro, no las puntas.
- UX: `R` cicla; los **números 1-9 y 0** eligen directo; tira de poses en el HUD.

## 3. Cuántos buscan (opción del host)

- `startGame(world, rng, seekers?)` + `clampSeekerCount` (entre 1 y jugadores−1).
- Control `{type:'start', seekers}` → `StartGameCmd.seekers`. Selector −/+ en el lobby
  (solo el host). Sin valor ⇒ reparto automático de antes.

## 4. Wire v7

- roleFlags: pose en **4 bits** (3-6) + `grounded` (bit 7).
- Snapshot: + `vy` (i16, cm/s) para reconciliar el eje vertical.
- INPUT: + byte de flags (bit0 = saltar). `decodeInput` tolera un cliente v6 abierto
  durante el deploy (sin ese byte). Un cliente viejo SÍ debe recargar para leer
  snapshots v7.

## 5. Gráficos

- **Posprocesado** (`PostFx.tsx`, librería base `postprocessing` + `n8ao`; el wrapper
  de R3F v3 exige fiber ≥9.7): oclusión ambiental (media resolución), bloom con
  umbral 2.4 (solo bombillas/sol/fogonazo; un blanco al sol no brilla), SMAA,
  viñeta, tone mapping Neutral al final de la cadena.
- **Relieve procedural** (`surfaceDetail.ts`): grano, variación de roughness y bump
  en espacio de mundo, baldosas de 1 m en suelos. Se aplica IGUAL a escenario y
  avatares (el detalle no delata al Hider). Sin texturas descargadas.
- **Cielo propio** (`SkyDome`): degradado + disco solar HDR. El cielo físico de drei
  daba una banda morada con el buffer HDR.
- Arma del Seeker miniaturizada junto a la cámara (no se mete en muros y no rompe
  el depth de la oclusión ambiental), con mira y depósito de pintura.
- Conmutador **✨ Alto/Bajo** en el HUD (localStorage `mecha.fx`); `dpr ≤ 1.5`.

## 6. Verificación

- 380 tests unitarios (sim 246 · frontend 68 · backend 37 · shared 29) + 28 de DO,
  typecheck, lint, build de producción del frontend.
- E2E local de 3 clientes: host elige 2 Seekers ⇒ roles `seeker,hider,seeker`;
  ápice Hider ≈1.2–1.3 m, Seeker ≈3.4–3.6 m; poses 6–9 por tecla; sin errores de
  shader ni de página; ~49 FPS headless con 3 pestañas y gráficos altos.
- NO verificado: rendimiento en equipos modestos/móvil, pisar muebles en una
  partida real (cubierto por tests del sim, no jugado a mano), balance.

## 7. Pendiente / a vigilar en playtest

- Balance del salto del Seeker (ver por encima de los muros acorta la búsqueda).
- Hitbox de la mesa (solo el centro) y del archivador (no cubre los 45 cm bajos).
- Pintura por partes y efecto de captura en el mundo (los dos puntos que el usuario
  eligió de la lista de ideas; siguen sin hacer).
