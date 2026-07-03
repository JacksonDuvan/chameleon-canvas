# 15 · Paso 12 — Mapa ALEATORIO por ronda (wire v5)

> Feedback del playtest: *"¿se puede hacer que el mapa sea aleatorio, que en cada ronda
> cambie? … la idea es que el Seeker no se aprenda el mapa y le toque más difícil"*.
> Ahora cada ronda genera un pueblo distinto — determinista y compartido.

---

## La idea y el reto

Un mapa aleatorio suena simple, pero en un juego server-autoritativo con predicción es
delicado: **cliente y servidor deben tener EXACTAMENTE el mismo mapa** o la colisión, la
oclusión del disparo y la predicción del movimiento se desincronizan. La solución es
generar el mapa de una **semilla** con una función pura y determinista, y hacer viajar
solo la semilla por el wire (no el mapa entero).

## Qué se construyó

- **`generateMap(seed): MapData`** ([`MapData.ts`](../packages/sim/src/core/map/MapData.ts)):
  genera un pueblo 48×48 aleatorio pero determinista — 4 barrios con paletas barajadas,
  casas de 3 muros con abertura aleatoria, estatuas/galletas/cajas/barriles/bolas con
  posición jittereada, plaza central de spawn siempre libre. Usa el RNG mulberry32
  (entero puro) y **cuantiza toda coordenada a rejilla de 0.1 m** → cero deriva de coma
  flotante entre isolates (server workerd ↔ navegador). `DEFAULT_MAP = generateMap(1)`.
  - **Determinismo testeado**: mismo seed ⇒ mapa byte-idéntico; y las invariantes
    (bounds=config, spawn libre, ≥16 muros, ≥6 figure, ≥4 figureWall, esfera+cilindro,
    ≥8 colores) se verifican sobre **10 semillas** (property-based), no una sola.
- **`WorldState.mapSeed`** + **`startGame` re-rollea** el mapSeed cada ronda (del RNG
  con semilla → determinista y server-autoritativo). El cliente nunca lo genera: lo
  recibe.
- **Wire v5**: `mapSeed` (u32) en el header del snapshot (keyframe + delta). Round-trip
  testeado. Cliente y servidor despliegan juntos (monorepo).
- **`IPhysicsWorld.setMap(map)`** + impl en Kinematic (reasigna los AABB de obstáculos)
  y Rapier (TODO). El **DO** regenera el mapa y llama `physics.setMap` cuando cambia el
  `mapSeed` (`ensureMap`, una vez por ronda), y pasa el mapa a `step`.
- **Cliente**: `worldStore` guarda `mapSeed` + `map`; `useGameSockets` regenera el mapa
  al cambiar el seed y **hila el mapa por la predicción/reconciliación** (colisión
  idéntica al servidor); `Environment` lee el mapa por selector reactivo (estado lento,
  re-render una vez por ronda) y **libera los recursos GPU** del mapa anterior.

## Verificación

- Suite: shared 7 · **sim 158** (+49 del generador) · backend 25 · frontend 33 · DO 6 ·
  typecheck · lint · build — verde.
- **E2E real (2 clientes)**: R1 ambos generan el MISMO mapa (seed 5875504, hash
  idéntico) y el disparo termina la ronda; R2 mapa NUEVO (seed 2106791952, distinto de
  R1) y de nuevo idéntico en ambos clientes. Captura del pueblo generado confirmada.

## Notas de tooling E2E (dolió, para futuras sesiones)

- Los Chrome headless de runs que fallan SIN `try/finally` quedan **huérfanos** y
  mantienen WebSockets abiertos → la sala `demo` acumula jugadores fantasma que retienen
  el host (no aparece "Empezar"). Siempre envolver el navegador en `try/finally`;
  `pkill -f "Google Chrome.*headless"` para limpiar.
- `pkill -f workerd` mata TAMBIÉN el workerd del frontend (plugin de Cloudflare en vite)
  → reiniciar ambos. El estado del DO local vive en `.wrangler/state/v3/do` (borrarlo
  resetea la sala persistida).

## Pendiente (siguiente)

- **Convertirse en cualquier figura** (caja/barril/…): el otro pedido del playtest —
  ampliar las poses a las formas del escenario (wire v6 con la pose en 3 bits). Es el
  siguiente paso.
- Post-V1: variar layouts de casa (U/L/torres), plazas descentradas, tamaño de barrio.
