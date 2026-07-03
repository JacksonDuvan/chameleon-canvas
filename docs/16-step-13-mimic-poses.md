# 16 · Paso 13 — Convertirse en figuras del escenario: poses caja y barril (wire v6)

> Feedback del playtest: *"sería bueno que yo pueda convertirme a cualquier figura del
> escenario"*. Ahora el Hider, además de las poses humanas, puede MIMETIZAR objetos del
> mapa: hacerse una **caja** o un **barril** — como las cajas y barriles que lo rodean.

---

## Qué se añadió

- **2 poses nuevas** ([`pose.ts`](../packages/sim/src/core/pose.ts)): `POSE_BOX` (4) y
  `POSE_CYLINDER` (5) → **6 poses** en total. La bola (`POSE_BALL`) ya cubría las
  esferas y la estatua de pie (`POSE_STAND`) los señuelos `figure`. Cada pose tiene su
  **hitbox** (`POSE_BODY_CY/R`) honesto con la silueta (test lo verifica).
- **`clampPose` robusto**: sanea CUALQUIER byte del cliente a `[0, POSE_COUNT)` (antes
  `& 3`; con 6 poses eso truncaba). El ciclo con 'R' ahora recorre las 6
  (`useLocalInput`: `(pose + 1) % POSE_COUNT`).
- **Geometrías** ([`avatarGeometry.ts`](../apps/frontend/src/features/canvas-3d/components/avatarGeometry.ts)):
  caja = `RoundedBoxGeometry` biselado ~1.1 m; barril = cilindro de 14 lados ~1.35 m.
  Comparten el material liso del avatar → un jugador pintado del color del prop se funde.
  Tests: la caja es cúbica (ancho≈fondo≈alto), el barril redondo en planta (x≈z).
- **Wire v6**: la pose pasa de 2 a **3 bits** (0..7) en los bits 3-5 de `roleFlags` (el
  bit 3 estaba reservado). Round-trip testeado para poses 4 y 5 sin pisar role/caught.
  El INPUT ya mandaba la pose como u8, sin cambios.
- **Render**: `MechaMesh` ahora tiene `POSE_COUNT` (6) InstancedMesh (antes 4 fijos) y
  ya no trunca la pose con `& 3`; caja/barril no se bambolean al caminar. HUD:
  etiquetas "Caja"/"Barril" y en el reveal.

## Verificación

- Suite: shared 8 · sim 161 (+ tests de 6 poses) · backend 25 · frontend 35 · DO 6 ·
  typecheck · lint · build — verde.
- **E2E real**: el Hider cicla con 'R' por las 6 poses (De pie→…→Caja→Barril, leído del
  estado real) y el render muestra la caja y el barril correctamente; el remoto los ve.

## Notas de diseño

- La transformación es **percepción + hitbox**, coherente con el resto: hacerse una
  caja verde entre cajas verdes engaña al Seeker humano y, si está tras cobertura, el
  hitbox bajo ayuda. No hay inmunidad.
- El mapa aleatorio (paso 12) siempre incluye cajas, barriles, bolas y estatuas — así
  SIEMPRE hay una figura que imitar en cada barrio, en cualquier ronda.
- Post-V1: más figuras (planta/jardinera, cono), y escalar la figura al prop concreto
  que tienes al lado (hoy el tamaño es fijo por pose).

## Estado de V1

Con esto quedan cerrados los dos pedidos del playtest (mapa aleatorio + mimetismo de
figuras). Pendiente de V1: **V1-E matchmaking por código** · V1-H audio · V1-I deploy.
