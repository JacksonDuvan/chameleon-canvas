# 13 · Paso 10 — Segunda ronda de feedback: miniciudad, fin instantáneo, temblor y caminata

> Respuesta al segundo playtest del pueblo: *"quisiera que hubiera casas, una especie
> de miniciudad… cuando dispare a un Hider debería darme feedback de que se atrapó y
> que ahí se acabe el juego porque todos fueron atrapados… agrega más tiempo a los
> Hiders… BUG: los hiders al moverse comienzan a temblar… sería bueno que los muñecos
> caminaran"*.

---

## Reglas de juego (sim, TDD)

- **Fin instantáneo de la caza** ([`step.ts`](../packages/sim/src/core/step.ts)): al
  caer el ÚLTIMO Hider la ronda pasa a `ended` con `outcome: seekers` EN EL MISMO TICK
  (como el original: no se espera el temporizador cuando no queda nadie a quien buscar).
  Tests: termina con el último + continúa si queda alguno.
- **Prep 45 → 60 s** (más tiempo para cruzar el pueblo, pintarse y posar).

## BUG del temblor — causa raíz y arreglo

La predicción escribe `local.pos` a **30 Hz** (tick de input) pero el render corre a
60–144 fps: el avatar avanzaba a saltos de ~20 cm y "temblaba" al caminar en 3ª
persona. El Seeker no lo notaba porque en FPP no se ve a sí mismo.

- **`sampleLocalMut`** ([`interpolation.ts`](../apps/frontend/src/features/canvas-3d/hooks/interpolation.ts),
  con tests): interpola linealmente entre la pos del tick anterior
  (`worldStore.localPrevPos`, estampada por `sendInput` ANTES de predecir) y la
  predicha, por el tiempo desde `localPredAt`. Clamp a [0,1]: nunca extrapola.
- La consumen **`MechaMesh`** (avatar local), **`CameraRig`** (todas las vistas — la
  FPP del Seeker también camina suave ahora) y **`LocalMarker`** (la flecha no vibra
  respecto al avatar). Tipo de salida estructural `{x,y,z}` (vale `Vec3` del sim o
  `THREE.Vector3`).

## Caminata (bamboleo de juguete)

Los muñecos **caminan**: balanceo lateral (`rotation.z`) + bote vertical con amplitud
proporcional a la velocidad estimada y fase acumulada POR JUGADOR (campos mutables en
`RemoteEntity`; módulo-scratch para el local). Solo en poses de pie/arrodillado (la
bola y el plano no se bambolean). Cero asignaciones por frame; sigue siendo el mismo
`InstancedMesh` por pose. Es presentación pura: la sim no cambia.

## Miniciudad (mapa v3) y HUD

- **+4 construcciones** en `DEFAULT_MAP`: cabaña salmón (NW), cabaña de esquina que
  usa el perímetro (NE), cabaña mostaza pálida (SW) y cobertizo en L (SE) — con más
  señuelos (2 estatuas, 2 galletas). Test nuevo: **≥16 tramos de muro** ("varias
  casas"). Total ~90 zonas; `referenceColorAt` sigue siendo barato (O(n) por Hider).
- **Contador de Hiders** en el HUD (`useHidersCount`, interval + bail-out): chip
  "🦎 quedan N · ✕ M" para TODOS — el feedback de captura que pedía el playtest (la
  fila de muñecos del original), complementa el hit-marker del tirador.

## Verificación

- Suite completa: shared 7 · **sim 109** (+3) · backend 23 · **frontend 28** (+3) ·
  DO 6 · typecheck · lint · build — verde.
- **E2E real del fin instantáneo** (headless Chrome, 2 clientes): disparo del Seeker →
  captura confirmada por el servidor → `hitPulse` 1 (hit marker) → `phase: ended`,
  `outcome: seekers` y overlay de victoria EN AMBOS clientes, con el temporizador aún
  con cuerda. Nota de tooling: el pointer lock es flaky en headless, así que la ruta
  `/` expone **hooks dev-only** (`window.__world`, `window.__look`, solo
  `import.meta.env.DEV`) para leer estado real y apuntar determinista en los tests E2E.

## Pendiente conocido

- El bamboleo de caminata es visible pero no articula extremidades (rig/skinning es
  post-V1). El siguiente paso sigue siendo **V1-F results/reveal** tras el playtest.
