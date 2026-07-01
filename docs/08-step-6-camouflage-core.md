# 08 · Paso 6 — Núcleo jugable de camuflaje (P0.1 → P0.2 → P0.3)

> Qué se construyó para convertir el esqueleto en *Meccha Chameleon*: **escenario con
> significado**, **camuflaje que importa** y **detección del Seeker por fijación**. Cierra
> las épicas P0 del [`docs/06`](06-roadmap.md). Decisión de diseño clave (camuflaje
> híbrido) razonada en [`docs/07`](07-librerias-cliente-3d.md).

---

## Resumen

Antes: cápsulas de color sobre un plano + 4 cajas; el cuentagotas pintaba pero **no
significaba nada**; el Seeker atrapaba con un raycast instantáneo que **ignoraba el
camuflaje**. Ahora:

- **P0.1** — El escenario es **dato compartido y determinista** en `@mecha/sim`, no colores
  sueltos en el cliente. Servidor y cliente ven el mismo mapa → el camuflaje es coherente.
- **P0.2** — El servidor calcula un **`camoScore` (0..1) determinista** por Hider (parecido
  de color al entorno + quietud) y lo difunde; el HUD muestra una **barra verde→rojo**.
- **P0.3** — La captura es **híbrida por fijación**: el Seeker mantiene el gatillo (F) y el
  `camoScore` del objetivo **alarga los ticks de mira sostenida** necesarios para taggear.
  Feedback: aviso "te están fijando" (`beingWatched`) + destello de captura.

Todo verde: `pnpm test` (shared 6 · sim 81 · backend 23 · frontend 18) · `test:do` 6 ·
`typecheck` · `lint`.

---

## P0.1 · Escenario compartido y determinista

**Nuevo:** [`packages/sim/src/core/map/MapData.ts`](../packages/sim/src/core/map/MapData.ts)
(+ test). Es la **única fuente de verdad** del escenario:

- `MapZone` — región AABB en XZ (con altura) + `color` de referencia empaquetado
  `0xRRGGBBAA` (sRGB) + `roughness`/`metalness` + `kind` (`floor`/`wall`/`prop`).
- `MapData` — `bounds`, `floorColor` (fallback), `zones[]`, `spawns[]`.
- `referenceColorAt(map, x, z, out)` — **determinista, sin asignaciones** (escribe en `out`):
  color de referencia del entorno bajo/junto a un punto. Prioridad: **prop/muro que
  abrazas** (margen 0.7 m) > **zona de suelo** que pisas > **suelo base**.
- `DEFAULT_MAP` — un salón: suelo en 5 zonas de colores distintos + 4 props de esquina
  (ladrillo/madera/musgo/metal) + 2 muros de piedra. 11 colores de superficie distintos.

**Cliente:** [`Environment.tsx`](../apps/frontend/src/features/canvas-3d/components/Environment.tsx)
renderiza desde `DEFAULT_MAP` (geometrías/materiales memoizados; colores en sRGB). Cada
malla lleva **`userData.refColor`** (los bytes de referencia exactos) para que el
cuentagotas absorba el color que el servidor puntúa (sin deriva sRGB↔lineal).

`GameMap` del backend sigue siendo scaffold (solo lo usa `phases.spawnPlayer` vía rejilla);
unificar spawns con `MapData.spawns` es un follow-up menor.

## P0.2 · Camuflaje que importa + barra

**Nuevo:** [`packages/sim/src/core/camouflage.ts`](../packages/sim/src/core/camouflage.ts)
(+ test):

- `computeCamouflage(color, ref, speed, cfg) → 0..1` — parecido de color (distancia
  euclídea RGB normalizada) × penalización por movimiento (`cfg.camoMovePenalty`).
- `requiredFixationTicks(camoScore, cfg)` — interpolación lineal entre
  `fixationMinTicks` y `fixationMaxTicks` (ver P0.3).

`PlayerState` gana `camoScore` (viaja en el snapshot). `step()` lo calcula por Hider tras
integrar el movimiento (pase 2), leyendo el color de referencia con `referenceColorAt`
(el mapa entra a `step` como parámetro, default `DEFAULT_MAP`). **Server-authoritative:**
el cliente solo lo muestra. HUD: barra verde→rojo por *poll* (patrón `usePhaseCountdown`,
sin `setState` por frame).

## P0.3 · Detección por fijación (híbrido)

`step()` pase 3 (sustituye la captura instantánea): un Seeker que **mantiene** CATCH
acumula `lockTicks` sobre el objetivo del raycast; captura cuando
`lockTicks ≥ requiredFixationTicks(target.camoScore)`. Soltar el gatillo, apuntar al vacío
o cambiar de objetivo **reinicia** la fijación. Nada pasivo (sin "detector" de Hiders).

- `PlayerState`: `beingWatched` (feedback, en el snapshot) + `lockTargetId`/`lockTicks`
  (solo servidor) + `wantsCatch` (transitorio).
- HUD: aviso "👁 ¡Te están fijando!" + destello "¡Atrapado!".

**Config** ([`config.ts`](../packages/sim/src/core/config.ts)): `camoMovePenalty=0.85`,
`fixationMinTicks=2` (visible ≈ instantáneo), `fixationMaxTicks=75` (camuflaje perfecto ≈ 2.5 s).

## Wire (`PROTOCOL_VERSION` 1 → 2)

[`wire.ts`](../packages/shared/src/protocol/wire.ts): +1 byte `camoScore` (u8) por jugador
en el snapshot; `beingWatched` = **bit 3** de `roleFlags`. La firma del delta incluye ambos
(si no, los cambios no se propagarían). Cliente y servidor despliegan juntos (monorepo).

## Consistencia de color (sRGB)

Entorno, avatar local y remotos interpretan los bytes como **sRGB**: `Environment` via
`setHex(...,SRGBColorSpace)`; `MechaMesh` local via `setRGB(...,SRGBColorSpace)`; remotos
via `.set(hex)`. El cuentagotas absorbe `userData.refColor` (bytes exactos del mapa) →
"color absorbido == color de referencia" y el avatar se ve igual que la superficie.

## Limitaciones conocidas / siguientes

- **Apunte del Seeker = dirección de movimiento** (no ratón). La fijación funciona pero un
  Seeker quieto no reorienta la mira con precisión → un **FPP con mouse-look** (P1) hará
  que se sienta bien. Es lo primero a mejorar para el pulido del Seeker.
- **Fijación estática es intencional:** el Seeker puede apuntar-y-sostener parado (no se
  exige moverse). Es fiel al "apunta y dispara" del original; el "barrer" de la biblia es
  ritmo sugerido, no regla. (Confirmado en la revisión adversarial como decisión, no bug.)
- Props sin **colisión sólida** (te atraviesan): el camuflaje-percepción no la necesita;
  se puede añadir determinista en `movement`/`collision` como follow-up.
- Sin **InstancedMesh** para props (pocos, mallas individuales): migrar cuando crezcan.

### Revisión adversarial (13 agentes) — arreglado
- **Velocidad stale → camoScore erróneo** (alta): `vel` se reseteaba solo al mover; ahora
  `step` la pone a 0 al inicio del tick (correcto ante pérdida de paquetes). + test.
- **Avatar por defecto** cambiado a **blanco** (255,255,255) — fiel a la biblia y hace que
  la barra de camuflaje arranque con sentido (no "semillena" confusa). Tests ajustados.
- **Color remoto** dejado explícito (`setHex(...,SRGBColorSpace)`; era falso positivo,
  `.set(hex)` ya usa sRGB). Descartados: poses (son P1) y un "gap de zona" mal calculado.
