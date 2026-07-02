# 10 · Paso 7 — Núcleo de esconderse de V1 (V1-A + V1-B + V1-C)

> Qué se construyó para que **esconderse sea real** (la regla innegociable de
> [`docs/09`](09-v1-scope.md)): escenario con **cobertura y oclusión**, **poses** que
> rompen la silueta con hitbox propio, y **Seeker en 1ª persona con mouse-look**.
> Cierra las épicas V1-A, V1-B y V1-C del charter.

---

## Resumen

Antes (Paso 6): el camuflaje ya importaba (score + fijación), pero el escenario era
plano/abierto, el avatar una cápsula erguida y el Seeker apuntaba con la dirección de
movimiento — **no había forma de esconderse**. Ahora:

- **V1-A** — El mapa tiene **muros perimetrales e interiores, cajas altas y bajas** que
  (1) **bloquean el rayo de captura** (oclusión: no se caza a través de un sólido) y
  (2) **colisionan** (no se atraviesan). Esconderse TRAS algo funciona de verdad.
- **V1-B** — **Poses** (de pie / agachado / bola / plano-pared) con 'R', **rotación** del
  avatar por el yaw del ratón, y **hitbox por pose**: agacharse tras una caja baja te
  cubre del rayo. La pose se fija al congelarse y durante Hunt (como el original).
- **V1-C** — **Seeker en 1ª persona** con **pointer lock + mouse-look** (yaw+pitch): el
  apunte 3D viaja en el wire y el rayo de captura tiene pitch. Retícula con **anillo de
  progreso de fijación**. El Hider juega en 3ª persona orbitando con el ratón (gira para
  encajar pose y auto-inspeccionarse). El Seeker **no ve el mapa en PREPARATION**
  (overlay), fiel a la biblia.

Todo verde: `pnpm test` (shared 7 · sim 101 · backend 23 · frontend 18) · `test:do` 6 ·
`typecheck` · `lint`. Golden de replay regenerado (cambio de reglas intencional).

## V1-A · Oclusión + colisión + mapa denso

- [`collision.ts`](../packages/sim/src/core/collision.ts): **`rayAABB`** (slabs,
  determinista, origen-dentro ⇒ 0) y **`resolveCircleAABBMut`** (círculo XZ vs AABB,
  empuje por normal o por eje de mínima penetración con orden fijo).
- [`movement.ts`](../packages/sim/src/core/movement.ts): `applyMovement(..., map)` expulsa
  al jugador de cada sólido (deslizamiento tangencial incluido). **Misma función en la
  predicción del cliente** → paridad.
- [`KinematicPhysicsWorld`](../packages/sim/src/physics/KinematicPhysicsWorld.ts):
  constructor acepta `MapData`; extrae los sólidos UNA vez (typed arrays);
  `raycastClosest` calcula el **primer bloqueo** y descarta impactos detrás (oclusión).
  La composition root del DO le pasa `DEFAULT_MAP`.
- [`MapData.ts`](../packages/sim/src/core/map/MapData.ts): `isSolidZone`/`zoneYMin/Max` +
  **`DEFAULT_MAP` denso**: recinto 30×30 (4 muros perimetrales), 4 muros interiores
  (esquinas + nicho en L), cajas altas (~2 m, cubren de pie) y bajas (~1 m, cubren
  agachado), estantería larga, jardineras — colores emparejados con el suelo de cada
  cuadrante. Spawn central (|x|,|z| ≤ 4.5) libre de sólidos.

## V1-B · Poses + rotación + hitbox por pose

- [`pose.ts`](../packages/sim/src/core/pose.ts): `POSE_STAND/CROUCH/BALL/FLAT`,
  `clampPose` (anti-cheat `& 3`), y **`POSE_BODY_CY`/`POSE_BODY_R`** (centro/radio de la
  esfera de impacto por pose). El efecto principal de la pose sigue siendo PERCEPTUAL
  (el Seeker humano no reconoce una "bola" verde entre cajas verdes); el hitbox añade el
  efecto mecánico de cubrirse tras cobertura baja.
- `UserCommand.pose` (u8, idempotente); `step` la valida (**hider + prep + !frozen**) y
  `predict` aplica la MISMA regla; `reconcile` incluye `pose`.
- Render: [`MechaMesh`](../apps/frontend/src/features/canvas-3d/components/MechaMesh.tsx)
  = **un `InstancedMesh` por pose** (cápsula / cápsula baja / esfera / panel), máx. 4 draw
  calls; cada avatar orientado por su yaw (`atan2(aimX, aimZ)`).

## V1-C · Seeker FPP + mouse-look

- [`useMouseLook`](../apps/frontend/src/features/canvas-3d/hooks/useMouseLook.ts):
  pointer lock al hacer clic; `lookState {yaw, pitch}` en módulo (transitorio, cero
  re-render); botón izquierdo = gatillo (`isCatchHeld`). Convención: yaw=0 mira −Z;
  forward = (−sin yaw, −cos yaw).
- [`useLocalInput`](../apps/frontend/src/features/matchmaking/hooks/useLocalInput.ts):
  WASD **relativo a la cámara**; apunte 3D desde yaw+pitch; 'R' cicla pose; click
  sostenido o 'F' = CATCH; 'Espacio' = FREEZE.
- **Wire v3**: INPUT += `aimY` (i16) + `pose` (u8) → 20 bytes; snapshot += pose (bits 4-5
  de `roleFlags`) + **`lockProgress`** (u8) para el anillo de la retícula. La firma del
  delta cubre ambos.
- [`CameraRig`](../apps/frontend/src/features/canvas-3d/components/CameraRig.tsx): FPP
  exacta (ojos, yaw+pitch) para Seeker en Hunt; 3ª persona orbitando por yaw para el
  Hider; vista aérea en lobby/ended. El avatar local no se dibuja en FPP.
- HUD: retícula + anillo de fijación, hint de pointer lock, **overlay de PREPARATION
  para el Seeker** (no ve cómo se esconden), etiqueta de pose, prompts por rol.

## Decisiones y notas

- **El pitch viaja en el wire** (aimY): sin él, un rayo horizontal no puede alcanzar a un
  agachado (inmunidad rota) ni respetar la cobertura baja. `raySphere/rayAABB` ya eran 3D.
- **El movimiento sigue siendo horizontal** (sin saltar/trepar): wall-stick/trepar es
  post-V1.
- La **pose no altera el `camoScore`** (la silueta es percepción humana, no un check del
  sistema — coherente con la decisión de `docs/07`); su efecto mecánico es solo el hitbox.
- `GameMap` (backend) sigue siendo scaffold; el mapa por sala llegará con matchmaking.

## Revisión adversarial (16 agentes) — arreglado

- **`aimY` no se reconciliaba** (alta): el snapshot no llevaba el pitch → tras
  reconciliar, el aim local quedaba "mixto". Ahora `aimY` viaja en el snapshot (+2
  bytes/jugador, en la firma del delta) y `reconcile` restaura el aim 3D completo. +test.
- **Overlay del Seeker en PREP al ~95%** (media): ahora **100% opaco** — ceguera
  funcional real (rotar la cámara no revela nada), fiel a la biblia.
- **Confirmado como correcto** (sin acción): tuning de fijación (66 ms visible ↔ 2.5 s
  camuflaje perfecto); mapa sin zonas selladas (nicho en L accesible); spawns fuera de
  sólidos. Descartados 9 falsos positivos (2 ya arreglados durante la revisión:
  `frustumCulled` de los `InstancedMesh` y el gatillo pegado al soltar el pointer lock).

## Paso 7.5 — Ajustes post-playtest (feedback del usuario)

El primer playtest real de V1 pidió tres cosas; las tres están hechas:

1. **DISPAROS como el original** (sustituye a la fijación): click (o F) = **1 disparo
   instantáneo** por pulsación con cooldown (~0.6 s), server-authoritative; acertar = tag.
   **Munición: ilimitada por defecto** (como el juego base — verificado contra el
   original) y **modo limitado opcional** fiel al update 2.3.0: fallar cuesta 1 bala,
   **acertar es gratis**, y si TODOS los Seekers llegan a 0 **los Hiders ganan al
   instante** (`SimConfig.ammoLimitEnabled`, futura opción del host en el lobby V1-E).
   El camuflaje vuelve a ser **percepción** (biblia literal); el `camoScore` queda como
   barra del Hider. Wire **v4**: `ammo` (u8) en el snapshot; fuera
   `beingWatched`/`lockProgress`. Decisión razonada en [`docs/07`](07-librerias-cliente-3d.md).
2. **Inputs que "no respondían"** — dos causas raíz arregladas:
   - **La trampa del congelado voluntario**: 'Espacio' congelaba PERMANENTE y sin aviso →
     WASD/R dejaban de responder. **Eliminado** (el congelado de Hunt es automático, como
     el original). Test de regresión incluido.
   - **Disparos por FLANCO con cola**: cada click/F encola un disparo que el tick de input
     consume — un click rápido entre ticks ya no se pierde. El pointer lock captura el
     rechazo del navegador (cooldown de ~1 s tras ESC) y el HUD mantiene el hint visible.
3. **Formas que emparejan con las poses** (el mundo "solo cajas"): `MapZone.shape`
   (`box`/`cylinder`/`sphere`, render; la colisión sigue AABB) + **bolas decorativas**
   (la pose "bola" desaparece junto a ellas), **barriles** y jardineras cilíndricas.
   El salto visual completo (assets low-poly CC0 + toon) sigue siendo V1-G.
4. **"Disparar no funciona / no se ve nada"** (2º playtest) — dos arreglos:
   - **`catchRange` 3 → 30 m**: el alcance era el del "toque" de la mecánica vieja;
     con 3 m el arma en FPP parecía rota (había que estar casi pegado al objetivo).
   - **Feedback del disparo**: **trazador** visual (pool en
     [`ShotTracers.tsx`](../apps/frontend/src/features/canvas-3d/components/ShotTracers.tsx),
     se corta en el primer obstáculo — no atraviesa muros a la vista) + **hit marker**
     en la retícula cuando el servidor **confirma** la captura (`hitPulse`, honesto:
     nunca lo decide el cliente). El sonido llega con V1-H.

## Qué falta para cerrar V1 (ver checklist en `docs/09`)

Results/reveal (V1-F) · matchmaking por código (V1-E) · pass visual estilizado (V1-G) ·
audio mínimo (V1-H) · deploy al edge (V1-I). El **núcleo de esconderse está completo**:
probarlo con 2+ navegadores (uno se esconde pintado+posado tras una caja; el Seeker debe
NO encontrarlo si lo hizo bien).
