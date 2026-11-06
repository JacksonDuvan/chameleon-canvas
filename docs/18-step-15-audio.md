# 18 · Paso 15 — V1-H: audio mínimo (SFX + ambiente + silbidos del host)

> Épica **V1-H** del charter ([`docs/09`](09-v1-scope.md), backlog P2.2): "SFX de
> captura + ambiente (silbido/whistling opcional)". "Hecho cuando: con la regla
> activa, los Hiders emiten silbidos audibles/posicionales" (roadmap P2.2).

## Qué se construyó

### Motor procedural (CERO assets)

`features/canvas-3d/audio/engine.ts` — todo se SINTETIZA con WebAudio: nada que
descargar, licenciar ni alojar en R2 (decisión consciente para V1: "juice barato
que sube mucho la diversión", docs/09 §V1-H):

- **Silbido**: seno ~1.8 kHz con vibrato (LFO 6 Hz, profundidad 28 Hz) + envolvente
  — imita el trino de un silbido humano; cada "voz" varía su frecuencia base.
- **Hit confirm** (captura confirmada por el servidor): dos blips triangulares
  880→1318 Hz (octava+quinta = "¡sí!").
- **Atrapado** (local): sawtooth 440→110 Hz con lowpass ("womp").
- **Disparo** del Seeker local: ráfaga de ruido filtrado + thump grave (feedback
  inmediato; el impacto lo sigue decidiendo el servidor).
- **Inicio de ronda** (lobby→prep): tono ascendente 330→660.
- **Fin de ronda**: arpegio C5-E5-G5 (victoria) o dos notas graves (derrota),
  según el bando del jugador local y el `outcome`.
- **Ambiente**: viento (ruido blanco → bandpass 480 Hz con LFO de 0.13 Hz que
  "respira") + pajaritos esporádicos (chirps aleatorios cada 3–8 s, pan aleatorio).
- **Join blip** al entrar a la sala.

Reglas aplicadas: presentación PURA fuera del ciclo React (`r3f-rendering`);
eventos de CAMINO FRÍO con nodos estables (espíritu de
`workers-memory-optimization`); y **el audio NUNCA rompe el juego**: sin
AudioContext (SSR/bloqueado) todos los métodos son no-ops, todos los accesos al
grafo van con guarda. Autoplay: `unlock()` en el primer pointerdown/keydown.

### Silbidos server-authoritative (regla del host)

- **Regla de dominio** (`domain/whistle.ts`, pura y testeada): cadencia
  `base·(1±25%)` — ni metrónomo predecible ni silencio injusto. El jitter se
  inyecta (`rand01`); la CADENCIA es dominio, el INSTANTE es presentación.
- **Scheduler** (`GameRoomDO.tickWhistles`): en HUNT, cada Hider vivo emite
  `{type:'whistle', playerId, x, y, z}` (JSON de control, camino frío). Estado
  volátil (no se persiste: un silbido no cambia el desenlace). Fuera de HUNT o
  con la regla apagada, se limpia.
- **La fija el HOST al crear la sala**: `?whistling=1` en el primer join (query
  del RoomForm → checkbox "Silbidos"); `whistleEverySec` saneado 1..60 (default
  14 s). Solo aplica a la creación FRESH — unirse no cambia la regla.
- **Cliente**: `parseWhistle` (defensivo) + `computeSpatial` (puro): pan estéreo
  por ángulo relativo al apunte del local (right = forward×up) y gain
  `1/(1+dist/8)`. El silbidor local NO se oye a sí mismo. El pan RESPETA el
  mouse-look (mirar a otro lado mueve el sonido al lado correcto).

### UI

- HUD: toggle 🔊/🔇 (pref en localStorage, `aria-pressed`).
- RoomForm: checkbox de la regla del host con tooltip explicativo (biblia UX:
  "selector con explicación breve").

## TDD y pruebas

| Suite | Qué cubre |
|---|---|
| backend node (41) | `whistleDelaySec`: jitter exacto 0.75/1/1.25, cotas para todo rand01, base mínima 1 s |
| backend workerd (26) | silbido CON regla activa llega con posición finita en HUNT; SIN regla no llega NINGUNO en 2.5 s; la config del host queda persistida en la sala |
| frontend node (66) | `computeSpatial`: delante/derecha/izquierda/respeta-yaw/decaimiento-distancia/guardas sin NaN (dist~0, apunte vertical); `parseWhistle`: válido/no-whistle/malformado sin lanzar |

**Total: 319 tests verdes** + `typecheck` + `lint` + E2E de regresión (2 navegadores).

## Notas

- El audio posicional es estéreo (pan+gain), no HRTF 5.1: suficiente y barato
  para V1; el hider escondido está QUIETO, así que no hay que actualizar el
  listener por frame (cero trabajo en el bucle de render).
- `whistleEverySec` es la perilla de balance del playtest: 14 s por defecto.
- El `whistling` de `RoomConfig` ya existía desde el Paso 1 (flag sin uso);
  este paso lo convierte en producto.
