# Paso 5 — Ciclo jugable + claridad (gameplay/UX pass)

Tras los 4 pasos de infraestructura (netcode, DO, R3F), el juego **funcionaba como
demo técnica pero no como juego**: no se entendía qué hacías, no sabías cuál avatar
eras y, sobre todo, **no se podía reiniciar la partida** (al llegar a `ended` se quedaba
ahí para siempre). Este paso cierra ese hueco mínimo de jugabilidad. **No** añade aún
las mecánicas profundas del original (ver §"Pendiente").

## Qué se añadió

### Reinicio de ronda ("jugar otra vez")
- **`@mecha/sim` · `resetToLobby(world)`** (en `core/phases.ts`): vuelve a `lobby`, limpia
  `outcome`/temporizador, devuelve a todos a `hider` (sin `frozen`/`caught`) y los
  re-posiciona en la rejilla de spawn. Determinista, sin RNG.
- **Use-case `RestartGame`** (gameplay): valida host (`NotHost`) y delega en
  `resetToLobby`. Devuelve `Result`. Tipado en `domain/errors.ts` (`RestartGameError`).
- **`GameRoomDO`**: handler de control `{type:'restart'}` (solo host) → `forceKeyframe`.
- **Cliente**: botón **"↻ Jugar otra vez"** en el panel de fin de ronda (solo host).

### Claridad de juego
- **`CameraRig`**: cámara en 3.ª persona que SIGUE al jugador local (suavizado por
  `delta`, mutación en `useFrame`, sin asignar). Resuelve "¿cuál cápsula soy yo?".
- **`LocalMarker`**: flecha flotante sobre tu avatar.
- **HUD**: muestra tu rol (🦎 Hider / 🔦 Seeker), cuenta atrás de fase (derivada del
  `serverTick` con `setInterval`, no por frame), y panel de fin con el resultado.
- **Errores legibles**: los `kind` del servidor (`NotEnoughPlayers`, `NotHost`, …) se
  traducen a mensajes claros y se auto-limpian a los 4 s. (`NotEnoughPlayers` exige
  **mín. 2 jugadores** → para probar en local hay que abrir 2 pestañas.)
- **`worldStore.localRole`**: estado lento publicado en cada snapshot (bail-out de los
  selectores; solo re-renderiza al cambiar de rol, p. ej. Hider atrapado → Seeker).

## Verificación
- `pnpm test`: shared 5 · sim 59 · backend 23 · frontend 18. `test:do` 5/5. typecheck
  (4) + lint limpios.
- Headless (Node WS, `scratchpad/ws-restart-test.mjs`): `start→prep`, `restart(host)→lobby`
  en ambos clientes, `restart` de no-host → `NotHost`, y `start` de nuevo → `prep`
  (se puede volver a jugar).
- Fantasmas (`ws-disconnect-test.mjs`): al cerrar el host, el otro cliente es promovido
  y el roster queda en 1 (sin fantasmas).

## Fix crítico: sala "envenenada" (no se podía volver a entrar)

Síntoma: ambas pestañas mostraban `○ desconectado` y "esperando a que el host
inicie…" para siempre, recargara lo que recargara.

Causa raíz: al irse el último jugador tras una ronda, la sala quedaba **persistida con
0 jugadores y fase != lobby** (`dropConnection` quitaba al jugador pero no reseteaba la
fase). El constructor del DO la rehidrataba así, y `PlayerJoin` rechazaba a TODO nuevo
jugador con `AlreadyStarted` → el DO devolvía **HTTP 409** → el WebSocket nunca hacía
upgrade → "desconectado" → nadie era host. El bucle no arrancaba, así que la
reconciliación periódica tampoco corría: **sala muerta permanente**.

Fix (verificado convirtiendo la `demo` real de 409 → 101):
1. `ensureRoom` reconcilia SIEMPRE (también si la sala ya estaba en memoria), no solo al
   cargarla de storage.
2. `reconcileRoster` resetea a lobby **siempre** que `players.size === 0 && phase != lobby`,
   sin depender de `changed` (antes solo reseteaba si había podado algo).
3. Cliente: **reconexión automática con backoff** (0.5→4 s) en `useGameSockets`, para que
   "desconectado" no quede pegado si el socket cae (server reiniciado, sala que renace).

Regresión cubierta en `GameRoomDO.test.ts` ("una sala vacía en fase != lobby RENACE en
lobby al reconectar").

## Pendiente (el "juego de verdad" del original Meccha Chameleon)
Esto sigue siendo un esqueleto jugable. Falta la esencia del original:
1. **Camuflaje real**: el cuentagotas absorbe color, pero no hay *feedback* de "cómo de
   bien estás camuflado" ni textura/forma del entorno; el Seeker no tiene una mecánica
   de detección basada en el contraste.
2. **Match de sombras / poses**: adoptar la silueta de objetos del escenario.
3. **Escenario rico**: el entorno es un plano + cajas; falta un set con objetos
   reconocibles donde esconderse a plena vista.
4. **Silbidos** (pista sonora opcional para el Seeker).
5. **Matchmaking real** (sala/lobby UI; hoy room fija `demo`).
6. **Feedback de captura** (efecto al atrapar; hoy es un raycast invisible).
