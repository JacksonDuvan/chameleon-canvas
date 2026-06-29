# 04 · Paso 4 — Cliente 3D (R3F) + netcode del lado cliente

> Registro de lo construido en el **Paso 4**. Estado: **completado** (lógica netcode +
> typecheck + lint verdes; **102 tests**). El render 3D NO se pudo verificar
> visualmente en este entorno — pendiente un `pnpm dev` en navegador (§7). Retoma
> desde aquí en otra sesión.

## 1. Objetivo

La experiencia visual 3D con **React Three Fiber** y el **netcode del lado cliente**:
predicción, reconciliación e interpolación consumiendo el wire binario del Paso 3, con
el estado desacoplado de Three.js en arquitectura feature-based y alto rendimiento R3F.

## 2. Qué se construyó

### Paridad servidor-cliente — `packages/sim/src/core/movement.ts`
Se EXTRAJO el movimiento de `step()` a funciones puras exportadas (`applyAim`,
`applyMovement`, `canMove`) que **servidor y cliente usan idénticas** → la predicción
converge. Test de paridad: el `step()` autoritativo y la predicción local producen la
misma posición para los mismos inputs.

### Netcode del cliente (PURO, testeado fuera de React)
| Archivo | Rol |
|---|---|
| `canvas-3d/store/worldStore.ts` | Zustand **vanilla**: estado RÁPIDO (`local` predicho, `remotes` con buffers, `serverTick`) mutado in situ + LENTO (`phase`, `outcome`, `connected`) vía setState |
| `matchmaking/hooks/prediction.ts` | `predict` (aplica input local con las funciones de `@mecha/sim`) + `reconcile` (descarta confirmados, resetea a autoritativo, RE-APLICA pendientes; **sin snap**) |
| `canvas-3d/hooks/interpolation.ts` | `sampleRemote` (lerp entre los 2 snapshots que rodean `now - 100 ms`, con clamp) + `pushRemoteSnapshot` (buffer podado) |

### Transporte (cablea la lógica pura testeada)
- `matchmaking/hooks/useGameSockets.ts`: abre el WS al DO, `binaryType='arraybuffer'`;
  en cada snapshot `decodeSnapshot` → reconcilia al local / acumula buffers de remotos /
  actualiza estado lento; `sendInput` predice + `encodeInput` + envía. Maneja `welcome`
  (fija `localPlayerId`).
- `matchmaking/hooks/useLocalInput.ts`: teclado (WASD/F/Espacio) → `UserCommand` a 30 Hz.

### Render R3F (capa driven; reglas de `r3f-rendering`)
- `canvas-3d/components/MechaMesh.tsx` → **`Players`**: un único **`InstancedMesh`**
  para todos los avatares; en `useFrame` MUTA matrices/colores de instancia leyendo el
  store por `getState()` (local predicho, remotos interpolados), con scratch de módulo
  (cero asignaciones por frame). Geometría y material memoizados.
- `canvas-3d/components/Environment.tsx`: suelo, **luz direccional con sombras** (clave
  para el "match de sombras") y superficies con colores (ladrillo/madera/…) de las que
  el cuentagotas absorbe color. Geometrías/materiales memoizados.
- `canvas-3d/hooks/useRaycastColor.ts`: el **cuentagotas** ('E' → raycast desde la mira
  → color del material → optimista local + control autoritativo). Raycaster reutilizado.
- `shared/components/Hud.tsx`: lee SOLO estado LENTO con selectores reactivos de Zustand.
- `routes/index.tsx`: monta el `<Canvas>` (client-only tras hidratar, para no romper el
  SSR de TanStack Start) + HUD; cablea `useGameSockets` + `useLocalInput` + cuentagotas.

### Tests del frontend — 15 (node, fuera de React)
`prediction.test.ts` (incl. **reconciliación**: re-aplica los no confirmados, sin snap;
convergencia de predicción errónea), `interpolation.test.ts` (lerp + clamp + poda),
`worldStore.test.ts` (frontera rápido/lento). **Total monorepo: 102 tests.**

## 3. Decisiones de arquitectura

- **Movimiento compartido** (`@mecha/sim/movement`) ⇒ paridad servidor-cliente real.
- **Frontera rápido/lento del store**: lo que cambia por frame se MUTA y se lee con
  `getState()`/`useFrame`; lo lento (HUD) usa selectores reactivos (`useStore`).
- **InstancedMesh para los jugadores**: una draw call, recuento dinámico sin re-render
  de React (todo en `useFrame`). Cubre "InstancedMesh para elementos duplicados".
- **Canvas client-only**: guarda `mounted` (WebGL + WebSocket no existen en SSR).
- **Vite 7**: requerido por `@tanstack/react-start`; compatible con `@cloudflare/vite-plugin`
  y Vitest 4 (verificado: sin regresión).
- **Hono RPC tipado diferido**: el juego va por WS binario; consumir `AppType` en el
  frontend requiere aislar el grafo de tipos de Workers (pendiente, no bloquea).
- **Rutas excluidas del `tsc --noEmit`**: TanStack Start tipa las rutas contra
  `routeTree.gen.ts` (generado en `vite dev`/`build`); se validan ahí.

## 4. Cumplimiento de reglas R3F

Sin `setState` por frame; valores animados mutados sobre instancias en `useFrame`;
estado rápido leído por `getState()`; geometrías/materiales memoizados y compartidos;
`InstancedMesh` para los avatares; scratch de módulo (sin asignar en el bucle);
selectores reactivos solo para estado lento (HUD). La simulación vive en el store
vanilla fuera de React.

## 5. Cómo ejecutar

```bash
nvm use && pnpm install
pnpm test                         # node: shared(5)+sim(57)+backend(20)+frontend(15)
pnpm --filter @mecha/backend test:do   # DO en workerd (5)
pnpm typecheck && pnpm lint
# Manual (navegador, no verificado aquí): backend y frontend a la vez
pnpm backend:dev    # wrangler dev (DO)
pnpm frontend:dev   # vite dev (genera routeTree.gen.ts y sirve el cliente)
```

## 6. Verificación (workflow adversarial)

Workflow de **4 lentes + síntesis** (netcode cliente, reglas R3F, memoria por frame,
arquitectura) sobre el código real. Suite ejecutada en Node 24.11: **105 tests verdes**
(frontend 18 incl. los de regresión) + typecheck (4 paquetes) + lint limpios.

**Must-fix corregido:**
- **Doble render del jugador local** (race `welcome`/snapshot): si un snapshot llegaba
  antes del `welcome` (sin `localPlayerId`), el local se creaba como remoto fantasma. →
  guard temprano en `applySnapshot` (`if (!st.localPlayerId) return`) + borrado del
  remoto coincidente al recibir el `welcome`.

**Defensas baratas aplicadas (mismo commit):**
- **Reconciliación robusta**: si `lastProcessedInput` RETROCEDE (rollback/desync del
  servidor), se limpia `pending` y se confía solo en el autoritativo (evita desfase
  permanente). + test de regresión.
- **Cota de `pending`**: ante pérdida de snapshots, se acota a ~4 s (120 inputs) para
  evitar crecimiento ilimitado y un pico de CPU en la re-predicción.
- **Tests nuevos**: retroceso de `lastProcessedInput`, respeto de fase al re-aplicar
  (un Hider no se mueve si se reconcilia en Hunt), y preservación de rol/flags/aim.

**Falsos positivos descartados (verificados):**
- *"`vertexColors: true` obligatorio para InstancedMesh"* — **falso**: en Three.js el
  color por instancia se activa con `instanceColor !== null` (lo crea `setColorAt`),
  independiente de `material.vertexColors`. Sin cambio.
- *"Remotos fantasma al desconectar por culpa de los deltas"* — **ya resuelto en el
  servidor**: `dropConnection` activa `forceKeyframe`, así el siguiente tick emite un
  KEYFRAME (~33 ms) que el cliente usa para podar el roster. Borrar en delta sería un
  BUG (los deltas NO son full-roster). Sin cambio.
- *Jitter de `renderTime` por FPS, micro-asignaciones de import, `seq` overflow* — ruido.

**Backlog (no bloquea; hot path sano):** reutilizar el `Set`/evitar el spread en
`applySnapshot` y un ring buffer en interpolación (≈5-10% menos GC en lobbies llenos).

## 7. Pendientes / siguientes pasos

- **Verificación visual/manual**: `pnpm frontend:dev` + `pnpm backend:dev` en navegador
  (WebGL + WS no verificables en este entorno). Confirmar conexión, predicción suave,
  interpolación de remotos y el cuentagotas.
- **Pipeline de assets `.glb`**: la arquitectura está preparada (feature `canvas-3d`,
  `public/models/`, InstancedMesh), pero hoy se usa geometría procedural (cápsula). Falta
  cablear `useGLTF` + loaders **Draco/Meshopt** y componentes generados con **gltfjsx**.
- **Apunte con ratón** (pointer lock) en vez de seguir la dirección de movimiento.
- **Matchmaking real**: `RoomForm`/`PlayerList` para fijar `roomId`/nombre (hoy fijos
  'demo'/'Player') y un lobby; surfacing de los frames de error del servidor en el HUD.
- **Monetización**: cablear los mocks de SDK (`features/monetization`) en los puntos de
  ronda (interstitial/rewarded) y la tienda de cosméticos (R2).
- **Netcode avanzado**: poda de `pending` si no llega snapshot; suavizado del error
  residual de reconciliación; lag compensation; delta por-cliente con acks.
- **Hono RPC tipado**: aislar el grafo de tipos de Workers para consumir `AppType`.
