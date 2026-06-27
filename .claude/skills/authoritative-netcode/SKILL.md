---
name: authoritative-netcode
description: >-
  Netcode con servidor autoritativo para juegos web multijugador en tiempo real
  sobre Cloudflare (Hono + Durable Objects + WebSockets). Usa esta skill SIEMPRE
  que el trabajo toque sincronización multijugador, bucles de juego, ticks,
  snapshots, input de jugadores, movimiento, detección de impactos, "el juego se
  siente con lag / hace rubber-banding / se desincroniza", la forma de los
  mensajes WebSocket, o cualquier servidor que coordine a más de un jugador,
  aunque no se digan las palabras "netcode", "predicción" o "lag compensation".
  Impone el modelo Valve/Source: servidor autoritativo con tickrate fijo,
  predicción del cliente, reconciliación, interpolación de entidades, lag
  compensation y formatos de red binarios compactos, todo mapeado sobre la
  WebSocket Hibernation API de Durable Objects. Aplícala antes de escribir
  cualquier código que envíe o reciba estado de juego por la red.
---
 
# Netcode Autoritativo y Predicción
 
Estás construyendo netcode para un juego web en tiempo real que debe ser rápido,
justo y resistente a trampas. El servidor es la única fuente de verdad. Los
clientes nunca confían entre sí, y la pantalla del propio cliente es una
*predicción* que el servidor puede corregir. Este es el modelo Valve/Source
adaptado a Cloudflare Durable Objects.
 
Lee este archivo entero antes de escribir código de red. Si la tarea solo toca un
subsistema (p. ej. solo serialización), puedes saltar a esa sección, pero las
reglas del núcleo de abajo son innegociables en todas partes.
 
## Las cinco innegociables
 
1. **El servidor es autoritativo.** Todo el estado que afecta al juego
   (posiciones, vida, puntuación, impactos) se calcula en el servidor. El cliente
   envía *inputs* (intenciones), nunca resultados. Un mensaje del cliente que diga
   "hice 50 de daño" es un bug o una trampa; uno que diga "presioné disparar en el
   tick 1042" es lo correcto.
2. **El tiempo del servidor es discreto (ticks); el del cliente es continuo
   (frames).** Nunca los confundas. El servidor simula pasos de tamaño fijo. El
   cliente renderiza tan rápido como permita la pantalla y cubre la diferencia con
   predicción e interpolación.
3. **El jugador local se predice; las entidades remotas se interpolan.** Tu propio
   avatar reacciona al instante (predicho por delante del servidor). Los demás se
   renderizan ligeramente en el pasado (interpolados entre snapshots recibidos)
   para que su movimiento sea suave.
4. **Reconcilia, nunca hagas snap.** Cuando un snapshot del servidor contradice la
   predicción del cliente, rebobina al tick confirmado y *re-aplica* los inputs no
   confirmados; no teletransportes al jugador a la posición del servidor. El snap
   es justo lo que causa el "rubber-banding".
5. **El formato de red es compacto y binario.** No transmitas JSON verboso 30
   veces por segundo. Envía deltas, cuantiza floats y prefiere payloads
   `ArrayBuffer`. (Ver `references/wire-format.md`.)
Si alguna vez te ves confiando en un valor del cliente, enviando el estado
completo cada tick, o haciendo `lerp` del jugador local hacia la posición del
servidor, detente: estás reintroduciendo los problemas exactos que esta skill
existe para evitar.
 
## El bucle de simulación (servidor)
 
El servidor corre con **timestep fijo**. Elige un tickrate y comprométete con él;
en este juego el bucle físico corre a **30 Hz** (`ProcessTick`). Source usa ~66 Hz
/ 15 ms, pero los juegos en el edge sacrifican tickrate por ancho de banda y
presupuesto de CPU. En cada tick el servidor:
 
1. Vacía la cola de `UserCommand` pendientes recibidos desde el último tick.
2. Aplica cada comando al mundo autoritativo vía la **simulación de dominio pura**
   (ver la skill `hexagonal-vertical-slicing`: la sim no debe importar Hono,
   WebSocket ni almacenamiento, y vive en el use-case `ProcessTick`).
3. Avanza física / reglas exactamente `dt = 1 / tickrate`.
4. Estampa el nuevo estado con el número de tick y, por jugador, el número de
   secuencia del **último input consumido** (`lastProcessedInput`).
5. Decide a quién actualizar y emite un snapshot (completo o delta).
Usa un acumulador de timestep fijo para que la tasa de simulación sea independiente
de cada cuánto se dispare realmente el bucle:
 
```ts
const TICK_MS = 1000 / 30; // tick autoritativo a 30 Hz
let acc = 0;
let last = now();
 
function pump() {
  const t = now();
  acc += t - last;
  last = t;
  while (acc >= TICK_MS) {
    stepSimulation(TICK_MS / 1000); // dt en segundos, siempre constante
    acc -= TICK_MS;
  }
}
```
 
Nunca avances la sim del servidor con un delta de reloj variable. Un `dt` constante
es lo que permite que el cliente corra el *mismo* código y prediga correctamente.
 
## Predicción en el cliente
 
La latencia hace que la respuesta del servidor a un input llegue un viaje de ida y
vuelta después. Si el cliente esperara, los controles se sentirían lentos. En vez
de eso, el cliente aplica sus propios inputs **de inmediato** a una copia local del
mundo, usando *el mismo código de simulación determinista* que el servidor
(compártelo vía el package de dominio).
 
El cliente mantiene un ring buffer de cada input enviado, etiquetado con un número
de **secuencia** monotónico y el `dt` usado:
 
```ts
interface PendingInput { seq: number; cmd: UserCommand; dt: number; }
const pending: PendingInput[] = [];
 
function onLocalInput(cmd: UserCommand) {
  const input = { seq: nextSeq++, cmd, dt: FRAME_DT };
  pending.push(input);
  applyInput(localPlayer, input);   // predice ahora
  socket.send(encode(input));       // y avisa al servidor
}
```
 
## Reconciliación con el servidor
 
Cuando llega un snapshot, trae `lastProcessedInput` para este jugador. El cliente:
 
1. Descarta todo input pendiente con `seq <= lastProcessedInput`: el servidor ya
   los contabilizó.
2. Resetea al jugador local al estado **autoritativo** del snapshot.
3. **Re-aplica** los inputs aún pendientes encima, en orden.
```ts
function onSnapshot(snap: Snapshot) {
  localPlayer.state = snap.players[myId].state;       // confía en el servidor
  while (pending.length && pending[0].seq <= snap.lastProcessedInput) {
    pending.shift();
  }
  for (const input of pending) applyInput(localPlayer, input); // re-predice
}
```
 
Si la predicción fue correcta, el resultado re-aplicado iguala a la pantalla actual
y nada se mueve visiblemente. Si fue errónea (chocaste con alguien que no veías),
el jugador termina suavemente donde dice el servidor, sin un snap brusco, porque
los inputs no confirmados se vuelven a aplicar. Opcionalmente suaviza el error
residual en unos frames, pero nunca hagas `lerp` ciego del jugador hacia la
posición cruda del servidor: eso reacopla tu entidad local responsiva al viaje de
ida y vuelta.
 
## Interpolación de entidades (jugadores remotos)
 
Solo recibes posiciones de los remotos a la tasa de snapshots, y los paquetes
llegan con jitter. Renderizarlos en la última posición conocida se ve a saltos. En
su lugar, **renderiza las entidades remotas en el pasado** por un retardo de
interpolación fijo (típicamente ~2 intervalos de snapshot, p. ej. 100 ms). Guarda
los últimos snapshots e interpola cada entidad remota entre los dos que rodean
`renderTime = now - interpDelay`.
 
Por esto un espectador que sigue a un jugador **no** ve exactamente lo que ese
jugador ve: las vistas remotas están desplazadas en el tiempo para suavizarlas.
 
## Lag compensation
 
Un jugador apunta a donde *ve* a un rival, que está `interpDelay + ping/2` en el
pasado. Para que los impactos se sientan justos, cuando el servidor procesa un
comando de disparo/ataque **rebobina** a los objetivos al estado del mundo que el
atacante realmente vio, comprueba el impacto ahí y vuelve al presente. Mantén un
ring buffer corto de estados autoritativos recientes (unos cientos de ms) para ese
rebobinado.
 
La lag compensation es una *decisión de diseño*: favorece al tirador y puede
producir momentos de "me dispararon detrás de la cobertura". Decide
explícitamente si tu juego la quiere. Típicamente solo se compensan los jugadores;
si necesitas que NPCs/props sean justos al impacto, debes compensarlos también
(Valve/Source documenta este mismo tradeoff).
 
## Mapeando todo esto sobre Cloudflare
 
**Topología.** El Worker (Hono) es el punto de entrada sin estado: autentica,
valida el request de upgrade y enruta el WebSocket al Durable Object correcto.
**Una instancia de Durable Object = una sesión de juego / sala.** El DO contiene el
mundo autoritativo, los sockets conectados y el bucle de tick. Es el patrón
canónico de Durable Objects: un objeto por unidad lógica que necesita coordinación.
En este repo ese DO es `GameRoomDO.ts`, en `infrastructure/entrypoints/`.
 
**Usa siempre la WebSocket Hibernation API.** Acepta sockets con
`state.acceptWebSocket(ws)` (no `ws.accept()`), e implementa los métodos handler
`webSocketMessage`, `webSocketClose`, `webSocketError`. Así el runtime puede
desalojar de memoria una sala inactiva manteniendo a los clientes conectados, que
es como evitas pagar por lobbies vacíos.
 
```ts
export class GameRoomDO extends DurableObject {
  async fetch(req: Request) {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);            // hibernable
    pair[1].serializeAttachment({ playerId, joinedTick: this.tick });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
 
  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string) {
    const cmd = decode(data);                     // nunca confíes más allá de decodificar
    this.enqueueInput(ws, cmd);
  }
}
```
 
**El estado en memoria es volátil.** Cuando un DO hiberna, el estado en memoria se
*descarta* y el constructor vuelve a ejecutarse en el siguiente evento. Persiste lo
que deba sobrevivir (marcador, quién está en la sala) en el storage del DO, y usa
`serializeAttachment`/`deserializeAttachment` para el estado por conexión, que así
sobrevive a la hibernación. Mantén el constructor barato.
 
**El bucle de juego vivo y la hibernación se excluyen mutuamente, a propósito.** Un
`setInterval`/`setTimeout` corriendo (o un bucle en curso) *impide* la hibernación.
Eso es correcto: mientras una partida se juega activamente, la sala *debe* seguir
en memoria y ticando. Dos patrones válidos:
 
- **`setInterval` mientras la partida está viva**, limpiado cuando la sala se vacía
  o la partida acaba. El DO permanece residente (y facturado) solo durante el juego
  activo y luego queda elegible para hibernar.
- **Alarms** (`storage.setAlarm`) para ticks de baja frecuencia o por turnos, o
  para programar el *siguiente* tick. Las alarms tienen entrega al-menos-una-vez y
  sobreviven al desalojo, pero el overhead por alarma las hace mala opción para un
  bucle ajustado de 30–60 Hz: usa `setInterval` para esos.
Decide según el tickrate: bucle de acción en tiempo real (30 Hz aquí) →
`setInterval`; lento/por turnos o "despiértame luego" → alarm. No intentes correr
un bucle de 30 Hz con alarms.
 
**Auto-responde a los pings sin despertar la sala.** Usa `setWebSocketAutoResponse`
para el ping/pong de heartbeat, así los keepalives no te facturan despertando una
sala hibernada.
 
## Disciplina del formato de red
 
El ancho de banda y la CPU son escasos en el edge. Antes de enviar nada cada tick:
 
- Envía **snapshots delta** (solo lo que cambió desde el tick confirmado del
  cliente), con "keyframes" completos periódicos para clientes recién unidos o
  desincronizados.
- **Cuantiza**: posiciones a enteros de punto fijo, ángulos a un byte o dos, etc.
  No envíes `number`s de precisión completa para cosas que el jugador no percibe.
- Prefiere **binario** (`ArrayBuffer` / `DataView` / una librería de esquema) sobre
  JSON en el camino caliente. Reserva JSON para mensajes de control raros (join,
  chat, fin de partida).
- Reutiliza y poolea los buffers de encode/decode (ver la skill
  `workers-memory-optimization`); asignar un buffer nuevo cada tick causará tirones
  por GC dentro de la sala.
Ver `references/wire-format.md` para tipos de mensaje concretos, secuenciación y un
boceto de delta-encoding.
 
## Línea base anti-trampas (gratis con este modelo)
 
Como el servidor es autoritativo y solo consume inputs, la mayoría de trampas de
movimiento y "daño imposible" son estructuralmente imposibles. Aun así: valida los
*rangos* del input (un jugador no puede pedir moverse más rápido que la velocidad
máxima), limita la tasa de comandos por conexión y haz clamp en el servidor. La
validación de comandos encaja con el patrón `Result` del repo: el use-case devuelve
`Err({ kind: 'InvalidCommand' })` en vez de lanzar (ver `hexagonal-vertical-slicing`).
Nunca reenvíes a otros clientes un resultado afirmado por el cliente.
 
## Definition of done
 
Un cambio es correcto bajo esta skill solo si: el servidor calcula todos los
resultados a partir de los inputs; el jugador local se predice y se reconcilia (sin
snapping); los jugadores remotos se interpolan en el pasado; el hitreg usa lag
compensation si el juego quiere impactos a favor del tirador; los sockets usan la
Hibernation API; el estado volátil se persiste antes de un posible desalojo; y el
payload por tick es un delta compacto, no JSON verboso.
 
## Referencia
 
- Valve, *Source Multiplayer Networking* — ticks, predicción, interpolación, lag
  compensation: https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- Valve, *Latency Compensating Methods in Client/Server In-game Protocol Design*:
  https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization
- Cloudflare, *Use WebSockets* (Hibernation API):
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare, *Build a WebSocket server with WebSocket Hibernation*:
  https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/
- Cloudflare, *Lifecycle of a Durable Object* (condiciones de hibernación, alarms):
  https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/