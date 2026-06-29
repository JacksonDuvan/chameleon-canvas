/**
 * useLocalInput — captura el teclado y envía un `UserCommand` por tick (~30 Hz) vía
 * el transporte. WASD = movimiento; 'F' = disparo del Seeker (CATCH); 'Espacio' =
 * congelar pose (FREEZE). El apunte sigue la dirección de movimiento (MVP).
 *
 * Skill `r3f-rendering`: el estado de teclas vive en un Set (ref), NO en estado de
 * React; no hay re-render por frame. El envío + predicción ocurren en `sendInput`.
 */
import { useEffect } from 'react';
import { ActionKind } from '@mecha/shared';
import type { GameSockets } from './useGameSockets';

const TICK_MS = 1000 / 30;

export function useLocalInput(sockets: GameSockets): void {
  useEffect(() => {
    const keys = new Set<string>();
    const down = (e: KeyboardEvent): void => void keys.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    const id = setInterval(() => {
      let moveX = 0;
      let moveZ = 0;
      if (keys.has('a')) moveX -= 1;
      if (keys.has('d')) moveX += 1;
      if (keys.has('w')) moveZ -= 1;
      if (keys.has('s')) moveZ += 1;

      let action: ActionKind = ActionKind.NONE;
      if (keys.has(' ')) action = ActionKind.FREEZE;
      else if (keys.has('f')) action = ActionKind.CATCH;

      const len = Math.hypot(moveX, moveZ);
      const aimX = len > 0 ? moveX / len : 0;
      const aimZ = len > 0 ? moveZ / len : 1;

      sockets.sendInput({ moveX, moveZ, aimX, aimZ, action });
    }, TICK_MS);

    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [sockets]);
}
