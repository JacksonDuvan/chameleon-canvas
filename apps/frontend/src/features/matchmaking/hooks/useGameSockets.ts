/**
 * useGameSockets — adaptador de transporte del cliente. Abre el WebSocket al DO,
 * PREDICE el input local (mismo `step` de `@mecha/sim` que el servidor),
 * RECONCILIA con cada snapshot (descarta inputs con seq <= lastProcessedInput y
 * re-aplica el resto; nunca hace snap) e INTERPOLA a los remotos en el pasado.
 * Escribe el resultado en `worldStore`.
 *
 * Skill `authoritative-netcode` (predicción/reconciliación/interpolación) +
 * `r3f-rendering` (escribe al store vanilla, no a estado de React) +
 * `tdd-testing`: la lógica pura (ring buffer de inputs, descarte por seq,
 * re-aplicación) se EXTRAE a funciones puras testeables fuera de React; este hook
 * solo cablea el socket y el ciclo de vida.
 *
 * SCAFFOLD del Paso 1 — implementación en el Paso 4.
 */
import { useEffect } from 'react';
import { worldStore } from '@/features/canvas-3d/store/worldStore';

export function useGameSockets(roomId: string): void {
  useEffect(() => {
    void worldStore;
    void roomId;
    // const ws = new WebSocket(`${WS_URL}/api/rooms/${roomId}/ws`);
    // ws.binaryType = 'arraybuffer';
    // ws.onmessage = (e) => onSnapshot(decode(e.data)); // reconciliar + escribir store
    // return () => ws.close();
  }, [roomId]);
}
