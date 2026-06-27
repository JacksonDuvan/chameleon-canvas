# Formato de red y protocolo de mensajes
 
Lee esto al diseñar o cambiar lo que circula por el WebSocket. El objetivo son
paquetes pequeños, predecibles y binarios, y una separación limpia entre *inputs*
(cliente → servidor) y *snapshots* (servidor → cliente).
 
## Familias de mensajes
 
Usa un byte inicial (o una unión etiquetada pequeña) para discriminar el tipo de
mensaje, de modo que el decoder sea un `switch` rápido y no una adivinación de la
forma del JSON.
 
**Cliente → Servidor**
- `INPUT` — el mensaje del camino caliente. Lleva `seq` (monotónico), el bitfield
  de input / la intención de movimiento, el tick del cliente y `dt`. Se envía cada
  frame del cliente (o en lotes). Es el *único* mensaje que afecta al juego.
- `JOIN` / `LEAVE` / `CHAT` / `PING` — mensajes de control raros. Aquí JSON está
  bien.
**Servidor → Cliente**
- `SNAPSHOT_FULL` — keyframe: estado completo del mundo + `tick` +
  `lastProcessedInput` por jugador. Se envía al unirse, a petición y
  periódicamente.
- `SNAPSHOT_DELTA` — solo los campos que cambiaron desde el tick confirmado del
  cliente. El mensaje del camino caliente.
- `EVENT` — eventos autoritativos puntuales (impacto confirmado, puntuación, fin de
  ronda).
## Campos obligatorios para la reconciliación
 
Todo snapshot DEBE incluir, para el jugador receptor:
- `tick` — el tick autoritativo que representa este snapshot.
- `lastProcessedInput` — el `seq` de input más alto que el servidor ha consumido
  para este jugador. El cliente lo usa para descartar inputs confirmados y
  re-aplicar el resto.
Sin estos dos campos, la predicción del cliente no puede reconciliar y tendrás
rubber-banding. No son opcionales.
 
## Boceto de delta-encoding
 
Mantén un "tick confirmado" por cliente y haz diff contra el estado del mundo en
ese tick.
 
```ts
function buildDelta(prev: WorldState, next: WorldState): Uint8Array {
  const w = new ByteWriter(reusableBuffer); // buffer pooleado, no uno nuevo cada tick
  w.u32(next.tick);
  w.u32(next.lastProcessedInput);
  for (const e of next.entities) {
    const before = prev.byId.get(e.id);
    const mask = changedFieldMask(before, e); // bitmask de campos sucios
    if (mask === 0) continue;                 // sin cambios → se omite por completo
    w.u16(e.id);
    w.u8(mask);
    if (mask & POS)   { w.q16(e.x); w.q16(e.y); } // punto fijo cuantizado
    if (mask & ANGLE) { w.u8(quantizeAngle(e.angle)); }
    if (mask & HP)    { w.u8(e.hp); }
  }
  return w.bytes();
}
```
 
## Reglas prácticas de cuantización
 
- **Posiciones**: enteros de punto fijo a la precisión que el jugador percibe (p.
  ej. centímetros). Envía `int16`/`int32`, no `float64`.
- **Ángulos**: 1 byte (256 pasos) suele bastar; 2 bytes para apuntado.
- **Velocidades**: a menudo derivables en el cliente; envíalas solo si hacen falta.
- **Booleanos / flags**: empácalos en un bitfield, nunca un booleano por campo.
## Haz / No hagas
 
- HAZ deltas + keyframes periódicos. NO envíes el estado completo cada tick.
- HAZ reutilización de buffers de encode/decode (ver `workers-memory-optimization`).
  NO asignes un `ArrayBuffer`/objeto nuevo por tick.
- HAZ el `INPUT` diminuto y frecuente. NO dejes que el cliente meta resultados
  calculados en él.
- HAZ versionado del protocolo con un byte para que los clientes viejos fallen
  ruidosamente, no en silencio.
- NO hagas `JSON.stringify` del mundo 30–60 veces por segundo en un isolate de
  128 MB.