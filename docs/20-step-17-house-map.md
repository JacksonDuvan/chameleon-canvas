# 20 · Paso 17 — Playtest r3: silbido MANUAL del Hider + mapa CASA (pasillos y cuartos)

> Feedback del playtest del usuario tras el lanzamiento de V1 (`docs/19`):
> 1. "El mapa tiene que ser mucho más grande y no cuadrado, tipo casa con
>    pasillos y cuartos."
> 2. "El tema de los silbidos está mal: los silbidos los tiene que hacer los
>    hiders y el mismo jugador los puede hacer, para darle pistas a los seekers
>    de dónde puede estar — más útil cuanto más grande es el mapa."

## 1. Silbido MANUAL del Hider (rework del sistema automático)

El sistema periódico automático (Paso 15, `docs/18` §silbidos server-
authoritative) SE RETIRA por feedback del playtest: el silbido pasa a ser una
**ACCIÓN del Hider** — como en el original, el que se esconde decide cuándo
dar la pista (tensión: atraer al Seeker lejos, o delatarse).

- **Cliente** (`useLocalInput`): tecla **T** = silbar (solo Hider vivo en Hunt;
  cooldown local de 2 s por UX). Hint del HUD actualizado: `… T silbar`.
- **Servidor** (`GameRoomDO.handleWhistle`): validación AUTORITATIVA — solo en
  HUNT, solo Hiders vivos, cooldown de 2 s anti-spam — y difunde
  `{type:'whistle', playerId, x, y, z}` a **TODOS** los sockets.
- **El silbidor se oye a sí mismo** (pan 0 / gain 1): confirmación de que la
  pista salió (antes se excluía al local; era parte de por qué "estaba mal").
- **Se retira** la regla del host (checkbox del RoomForm, `?whistling=1`,
  `whistleEverySec` en `RoomConfig`, scheduler `tickWhistles` y la regla de
  cadencia `domain/whistle.ts`): el silbido es parte del juego base, siempre
  disponible — menos config, más juego.

### Pruebas (TDD, workerd)

Silbido manual llega a todos con posición finita · el Seeker NO puede silbar ·
ráfaga de 5 ⇒ exactamente 1 (cooldown) · fuera de Hunt no se silba. El
scheduler automático y sus tests se eliminaron con el sistema.

## 2. Mapa CASA procedural (80×64 m, no cuadrado, pasillos + cuartos)

Reemplaza al pueblo 48×48 como `generateMap(seed)` (misma firma: wire v5
`mapSeed` intacto, cliente y servidor regeneran idéntico).

### Arquitectura del generador (verdad compartida muros⇔puertas)

1. **`generateHousePlan(seed)`** — el PLANO en rejilla de celdas de 4 m
   (20×16 celdas = 80×64 m = bounds del SimConfig):
   - **Anillo** de pasillo perimetral + **cruz central** (2 celdas de ancho):
     4 bloques de cuartos entre ambos. El spawn es la intersección (hall 8×8).
   - **Huella NO cuadrada**: se TIRA un ala completa (un bloque de esquina,
     aleatorio por semilla ⇒ casa en L/U) + recortes en L en otras esquinas.
   - **Cuartos** por cortes de guillotina (mín 2×2 celdas = 8×8 m): 24-28
     cuartos, cada uno con **paleta propia** (8 paletas de "estancias":
     cocina terracota, baño teal, sala mostaza, cuarto navy, estudio ciruela,
         jardín bosque, garaje roble, lavadero gris).
   - **Puertas**: 1-2 por cuarto con preferencia al pasillo (si no, cuarto
     vecino), registradas como ARISTAS ABIERTAS.
2. **`isEdgeOpen(plan, …)`** — UNA sola verdad de "¿se puede pasar entre dos
   celdas?" consultada por la emisión de muros Y por el test de conectividad
   (BFS): si un cuarto quedara sellado, el BFS falla. Test: **toda celda de
   piso es alcanzable desde el spawn** para varias semillas.
3. **`planToMapData`** — el plano → zonas: suelos por cuarto y por tramo de
   pasillo (colores rotando), **muros por aristas cerradas con fusión de
   tramos** (50 muros, no 130), muros de perímetro CLAMPED dentro de bounds,
   y **props de mimetismo por cuarto**: estatua `figure` (más una segunda en
   cuartos grandes), caja, barril y bola + galleta `figureWall` en el muro
   izquierdo del cuarto.

### Cambios de balance ligados al mapa (sujetos al próximo playtest)

| Parámetro | Antes (pueblo) | Ahora (casa) |
|---|---|---|
| Tamaño | 48×48 (2 304 m²) | 80×64 (5 120 m² de bounds, ~4 200 m² de piso) |
| `bounds` (SimConfig) | ±24 | ±40 x / ±32 z |
| Prep | 60 s | **75 s** (llegar al escondite en una casa grande) |
| Hunt | 120 s | **180 s** (barrer ~26 cuartos + pasillos) |
| Rejilla de spawn (`spawnPlayer`) | 5×5 paso 2 m (±4) | 5×5 **paso 1.4 m** (±2.8, cabe en el hall) |
| Vista lobby / niebla / sombras | plaza | overview 46 m, niebla 60-170, sombras ±52 |

### Pruebas

- Sim: 199 tests (se mantuvieron los de `referenceColorAt`/DEFAULT_MAP; los
  invariantes del pueblo se reemplazaron por los de la casa: bounds 80×64,
  huella irregular —área de piso 50-95 % del rectángulo—, ≥10 cuartos con ≥6
  paletas, ≥24 muros, ≥10 estatuas, ≥6 galletas, spawn libre, y el **BFS de
  conectividad** + rectángulos disjuntos + ≥1 puerta por cuarto).
- El **golden del replay** se actualizó (diff = solo la nueva rejilla de
  spawn; roles/poses/determinismo intactos).
- `step.test` del clamp: 200 ticks (el mapa es 80 m; 100 no llegaban).
- Corrección de bug encontrado por los tests: los muros de perímetro nacían
  centrados en la arista exterior y sobresalían 0.3 m de los bounds ⇒
  `pushWall` los clava por dentro.

## Pendiente

- Playtest del balance en la casa (Prep 75 / Hunt 180 / densidad de cuartos).
- Las colinas decorativas del horizonte se ven sobre los muros de la casa:
  aceptable para V1 (el cielo sigue dando ambiente); si molesta, subir la
  altura de muro o techos (post-V1).
