# 06 · Roadmap maestro — del esqueleto al clon completo

> Documento de planificación priorizado. Inventario de **todo lo que falta** para que
> este proyecto sea un clon jugable y completo de *Meccha Chameleon*, ordenado por
> prioridad. Fuente de alcance: [`00-initial-prompt.md`](00-initial-prompt.md). Estado
> de partida: pasos 1–5 ejecutados (ver `git log` y `docs/01`–`05`).
>
> **Cómo leer la prioridad:** `P0` = sin esto no *es* el juego · `P1` = mecánicas que
> definen su identidad · `P2` = experiencia multijugador completa · `P3` = monetización
> · `P4` = producción/pulido. Dentro de cada Px, el orden es el sugerido de ejecución.
> Esfuerzo relativo: **S** (horas) · **M** (1–2 días) · **L** (varios días) · **XL** (semana+).

---

## 1. Dónde estamos (cimientos ✅)

Sólido y verificado con tests:

- **Monorepo** pnpm + catalog; TS strict; ESLint con boundaries arquitectónicos.
- **Kernel determinista** `@mecha/sim` (movimiento, fases, RNG con semilla, colisión)
  compartido server+cliente → habilita predicción.
- **Backend autoritativo**: Durable Object = sala, bucle 30 Hz, wire binario
  KEYFRAME/DELTA, Hibernation API. Salas robustas (renacen, reconcilian roster, host
  se reasigna). Slices `gameplay` + `monetization` (puertos).
- **Cliente R3F**: predicción/reconciliación/interpolación, InstancedMesh, cuentagotas
  de color, cámara que sigue, HUD (rol/fase/timer), ciclo jugable (empezar/reiniciar).
- **Reconexión** automática del socket.

## 2. Brecha vs. el juego original (mapa de reglas → estado)

| Regla original (prompt §"Reglas de negocio") | Estado | Qué falta |
|---|---|---|
| Flujo 3 fases Lobby→Prep→Hunt (+Ended) | ✅ | — |
| Camuflaje: cuentagotas 'E' absorbe color del entorno y pinta el avatar | 🟡 parcial | textura/patrón (no solo color plano); **feedback de calidad** de camuflaje |
| **Detección por camuflaje** (el Seeker no ve al que se funde bien) | ❌ | toda la mecánica — es el corazón del juego |
| Poses + rotación del avatar para encajar en esquinas | ❌ | solo existe "congelar" (FREEZE); faltan poses múltiples y rotación |
| Match de sombras (la sombra delata) | ❌ | lógica de sombra como factor de detección |
| Whistling (pista sonora periódica, opción del host) | ❌ | flag `whistling` existe en config; sin implementación ni audio |
| Hider atrapado → Seeker | ✅ lógica | falta **feedback visual** de captura y balance |
| Hiders ganan si sobrevive ≥1 | ✅ | — |
| Captura por interacción del Seeker ('F') | 🟡 parcial | raycast funciona pero **ignora el camuflaje** y no tiene feedback |
| Escenario con materiales/colores/texturas llamativas (ladrillo, madera) | 🟡 parcial | hoy: plano + cajas de color; faltan texturas/props ricos |
| Durable Objects (coordinación WS stateful) | ✅ | — |
| Monetización: puertos + mocks (ads, tienda R2, Premium) | 🟡 parcial | puerto+entitlement listos; falta **todo el frontend** y SDKs |
| Hono RPC `AppType` end-to-end | 🟡 parcial | tiempo real va por WS; RPC HTTP de control sin cablear al cliente |
| Pipeline `.glb` (Draco/Meshopt/gltfjsx), modelo de camaleón | ❌ | hoy son cápsulas primitivas |
| Matchmaking UI (RoomForm, PlayerList, unirse por código) | ❌ | sala fija `demo`, nombre fijo `Player` |
| Predicción / reconciliación / interpolación | ✅ | — |
| Lag compensation en la captura | ❌ | diseñado en la skill; no implementado |

---

## P0 · Núcleo jugable — "que SEA Meccha Chameleon"

> Sin esto seguimos teniendo un escondite genérico. Estas tres épicas están acopladas
> (el camuflaje no significa nada sin un escenario donde fundirse, ni sin que el Seeker
> reaccione a él) y conviene hacerlas en este orden.

### P0.1 · Escenario con materiales variados — **M**
- **Objetivo:** un mapa pequeño pero con superficies de colores/patrones distintos
  (paredes, suelo por zonas, props como cajas/barriles) donde tenga sentido camuflarse.
- **Alcance:** ampliar `features/canvas-3d/components/Environment.tsx` con varias
  superficies y materiales; exponer en `@mecha/sim` (o en un mapa de datos compartido)
  el **color dominante por zona/superficie** para que el servidor pueda razonar sobre
  camuflaje de forma determinista. Geometrías/materiales memoizados; props con
  `InstancedMesh`. Colisiones de los props en el puerto de física.
- **Hecho cuando:** el escenario tiene ≥4 superficies de color claramente distinto y el
  servidor conoce el color de referencia de cada punto del mapa.
- **Skills:** `r3f-rendering`, `hexagonal-vertical-slicing`, `workers-memory-optimization`.

### P0.2 · Camuflaje que importa + feedback — **M**
- **Objetivo:** el cuentagotas pinta tu avatar **y** existe una medida de "qué tan
  camuflado estás" respecto al entorno cercano.
- **Alcance:** value-object/cálculo determinista de **diferencia de color** (avatar vs.
  color de referencia del entorno bajo el jugador) en `@mecha/sim`; penalización por
  movimiento (moverte te delata). HUD: **barra de camuflaje** verde→rojo (estado lento).
  Mantener el camuflaje server-authoritative (el cliente no decide si está oculto).
- **Hecho cuando:** absorber el color del muro detrás de ti sube la barra a verde y
  moverte la baja; el valor lo calcula el servidor de forma determinista.
- **Skills:** `authoritative-netcode`, `tdd-testing` (test del cálculo de camuflaje),
  `r3f-rendering`.

### P0.3 · Detección del Seeker basada en camuflaje + feedback de captura — **M**
- **Objetivo:** el Seeker **solo puede atrapar** a Hiders "visibles" (mal camuflados o
  en movimiento); el bien camuflado y quieto es prácticamente inmune.
- **Alcance:** en `step.ts`, el raycast de captura comprueba el **score de camuflaje**
  del objetivo (umbral) antes de convertirlo; quizá un "tiempo de fijación" del Seeker.
  Feedback visual: destello/partículas al capturar, indicador de "te están mirando".
- **Hecho cuando:** un Hider verde+quieto no puede ser atrapado aunque el Seeker le
  apunte; uno rojo/en movimiento sí. Tests de determinismo del nuevo `step`.
- **Skills:** `authoritative-netcode`, `tdd-testing`, `r3f-rendering`.

**Resultado de P0:** una ronda de 2+ jugadores se juega y *se siente* como el original.

---

## P1 · Mecánicas distintivas del original

### P1.1 · Poses + rotación del avatar — **M**
- **Objetivo:** el Hider puede rotar y elegir entre varias poses para encajar en
  esquinas/contra props.
- **Alcance:** extender el `UserCommand`/wire con pose+yaw (cuidando el formato binario);
  estados de pose en `PlayerState`; render de poses en el avatar. Determinista.
- **Hecho cuando:** 'Espacio' cicla poses y el avatar rota; persiste al congelarse.
- **Skills:** `authoritative-netcode` (wire), `r3f-rendering`, `tdd-testing`.

### P1.2 · Match de sombras — **L**
- **Objetivo:** la sombra del Hider congelado lo delata si la luz no se calculó bien.
- **Alcance:** luz direccional con sombras (ya hay `shadows` en el Canvas); factor de
  "exposición de sombra" que sume al score de visibilidad del Seeker. Equilibrio
  rendimiento (shadow maps) vs. límites.
- **Hecho cuando:** colocarte donde tu sombra cae a la vista te hace más detectable.
- **Skills:** `r3f-rendering`, `authoritative-netcode`.

### P1.3 · Pulido del bucle de roles — **S**
- **Objetivo:** que "Hider atrapado → Seeker" se entienda y se sienta.
- **Alcance:** feedback al convertirte (cambio de HUD, color, mensaje); recuento de
  Hiders vivos en el HUD; transición de fin más clara.
- **Skills:** `r3f-rendering`.

---

## P2 · Experiencia multijugador completa

### P2.1 · Matchmaking / salas — **L**
- **Objetivo:** crear/unirse a salas por código, no `demo` fija.
- **Alcance:** `features/matchmaking/components/RoomForm.tsx` + `PlayerList.tsx`;
  pantalla previa de nombre+sala; **Hono RPC `AppType`** para crear/listar salas
  (cerrar la deuda de `endpoints.ts`); lista de jugadores en lobby leyendo el roster.
- **Hecho cuando:** dos navegadores entran a la misma sala por código y se ven en el lobby.
- **Skills:** `hexagonal-vertical-slicing`, `authoritative-netcode`.

### P2.2 · Audio + Whistling — **M**
- **Objetivo:** pista sonora; silbidos opcionales de los Hiders (regla del host).
- **Alcance:** capa de audio (SFX de captura, ambiente, silbido); el flag `whistling`
  de `RoomConfig` dispara un evento periódico/manual con pista posicional (audio 3D).
- **Hecho cuando:** con la regla activa, los Hiders emiten silbidos audibles/posicionales.
- **Skills:** `r3f-rendering` (audio espacial), `authoritative-netcode` (evento).

### P2.3 · Identidad y UX de jugador — **S**
- Nombres visibles, colores de equipo, indicadores sobre cabezas (con cuidado de
  rendimiento), estados de "listo".

---

## P3 · Monetización (puertos listos → producto)

> El dominio ya define `IMonetizationService` y un adaptador KV con `premiumClub`.
> Falta el lado de producto. Todo bajo `features/monetization` y el slice `monetization`.

### P3.1 · Anuncios rewarded / interstitial — **M**
- SDK real (CrazyGames / AdSense for Games) tras un adaptador; `AdPlaceholder.tsx` →
  anuncios reales antes/después de ronda; rewarded para recompensas.

### P3.2 · Tienda de cosméticos — **L**
- `CosmeticsShop.tsx`; texturas premium servidas desde **Cloudflare R2/KV**; aplicar
  cosmético al avatar; validación de propiedad en el backend.

### P3.3 · Premium Club — **S/M**
- Verificación de suscripción para saltar anuncios; el entitlement ya fluye por el puerto.

---

## P4 · Producción y pulido

- **P4.1 · Pipeline de assets `.glb`** — **L**: modelo de camaleón real (en vez de
  cápsulas), Draco/Meshopt + `gltfjsx`, LODs. Sustituye el placeholder de `MechaMesh`.
- **P4.2 · Lag compensation** — **M**: la skill `authoritative-netcode` lo prevé;
  rebobinar para validar capturas con RTT alto.
- **P4.3 · Despliegue producción** — **M**: `wrangler deploy` backend+frontend, KV/R2
  reales, dominios, variables; smoke test en el edge.
- **P4.4 · Observabilidad y anti-cheat** — **M**: métricas de sala/tick, validación de
  inputs imposibles, límites de rate.
- **P4.5 · Accesibilidad / móvil / i18n** — **L**: controles táctiles, escalado de UI,
  textos. (Hoy el juego asume teclado.)
- **P4.6 · Tests E2E** — **M**: flujo completo headless (varios clientes, ronda entera).

---

## 5. Resumen priorizado

| # | Épica | Prioridad | Esfuerzo | Depende de |
|---|---|---|---|---|
| P0.1 | Escenario con materiales variados | P0 | M | — |
| P0.2 | Camuflaje que importa + barra | P0 | M | P0.1 |
| P0.3 | Detección del Seeker + feedback captura | P0 | M | P0.2 |
| P1.1 | Poses + rotación | P1 | M | P0 |
| P1.2 | Match de sombras | P1 | L | P0.3 |
| P1.3 | Pulido del bucle de roles | P1 | S | P0.3 |
| P2.1 | Matchmaking / salas (+ Hono RPC) | P2 | L | — |
| P2.2 | Audio + Whistling | P2 | M | — |
| P2.3 | Identidad de jugador | P2 | S | P2.1 |
| P3.1 | Anuncios rewarded/interstitial | P3 | M | — |
| P3.2 | Tienda de cosméticos (R2) | P3 | L | P4.1 |
| P3.3 | Premium Club | P3 | S/M | P3.1 |
| P4.1 | Pipeline `.glb` + modelo real | P4 | L | — |
| P4.2 | Lag compensation | P4 | M | P0.3 |
| P4.3 | Despliegue producción | P4 | M | — |
| P4.4 | Observabilidad / anti-cheat | P4 | M | — |
| P4.5 | Accesibilidad / móvil / i18n | P4 | L | — |
| P4.6 | Tests E2E | P4 | M | P2.1 |

## 6. Principios de ejecución (no-regresión)

1. **Verificación visual/jugable temprana** en cada épica (navegador o headless), no al final.
2. **TDD** del dominio y del netcode; tests de determinismo cuando cambie `step`.
3. **Determinismo** server=cliente: toda mecánica que el cliente prediga vive en `@mecha/sim`.
4. **Camino caliente sin asignaciones**; estado rápido fuera de React.
5. Cada épica termina con `pnpm test` + `test:do` + `typecheck` + `lint` en verde y un commit.

> **Siguiente recomendado:** **P0.1 → P0.2 → P0.3** (núcleo jugable). Es lo que convierte
> la demo en el juego, y reutiliza casi todo lo existente.
