/**
 * useLocalInput — construye y envía un `UserCommand` por tick (~30 Hz) a partir del
 * teclado + el mouse-look (V1-C):
 *  - WASD se interpreta RELATIVO A LA CÁMARA (adelante = hacia donde miras).
 *  - El apunte (`aimX/aimY/aimZ`) sale del yaw/pitch del ratón (`lookState`), no de la
 *    dirección de movimiento: el Seeker apunta con el ratón como en un FPS.
 *  - 'R' cicla la pose del Hider (de pie → agachado → bola → plano); viaja como campo
 *    idempotente del comando y el servidor la valida (rol/fase/frozen).
 *  - DISPARO (modelo del original): click (con el ratón capturado) o 'F' = 1 disparo
 *    por pulsación (flanco, no mantenido). La munición y el impacto los resuelve el
 *    servidor. No hay congelado voluntario: en Hunt el servidor congela a los Hiders.
 *
 * Skill `r3f-rendering`: teclas y pose viven en closures/refs (NO estado de React);
 * cero re-render por tick. El envío + predicción ocurren en `sendInput`.
 */
import { useEffect } from 'react';
import { ActionKind } from '@mecha/shared';
import { lookState, consumePendingShot } from '@/features/canvas-3d/hooks/useMouseLook';
import { signalLocalShot } from '@/features/canvas-3d/components/ShotTracers';
import { worldStore } from '@/features/canvas-3d/store/worldStore';
import type { GameSockets } from './useGameSockets';

const TICK_MS = 1000 / 30;

export function useLocalInput(sockets: GameSockets): void {
  useEffect(() => {
    const keys = new Set<string>();
    let pose = 0; // pose deseada (cicla con 'R'); el servidor la sanea/valida
    let pendingKeyShots = 0; // disparos encolados con 'F' (flanco de tecla)

    const down = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (k === 'r' && !e.repeat) pose = (pose + 1) & 3;
      if (k === 'f' && !e.repeat) pendingKeyShots++;
      keys.add(k);
    };
    const up = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    const id = setInterval(() => {
      // Intención WASD en espacio de cámara: adelante/atrás + strafe.
      let fwd = 0;
      let strafe = 0;
      if (keys.has('w')) fwd += 1;
      if (keys.has('s')) fwd -= 1;
      if (keys.has('d')) strafe += 1;
      if (keys.has('a')) strafe -= 1;

      // Base horizontal de la cámara: forward = (−sin yaw, −cos yaw); right = (cos yaw, −sin yaw).
      const sinY = Math.sin(lookState.yaw);
      const cosY = Math.cos(lookState.yaw);
      const moveX = -sinY * fwd + cosY * strafe;
      const moveZ = -cosY * fwd - sinY * strafe;

      // Apunte 3D desde yaw+pitch (normalizado por construcción).
      const cosP = Math.cos(lookState.pitch);
      const aimX = -sinY * cosP;
      const aimY = Math.sin(lookState.pitch);
      const aimZ = -cosY * cosP;

      // Un disparo por pulsación (click o 'F'): consume UNO de la cola por tick.
      let action: ActionKind = ActionKind.NONE;
      if (consumePendingShot()) action = ActionKind.CATCH;
      else if (pendingKeyShots > 0) {
        pendingKeyShots--;
        action = ActionKind.CATCH;
      }

      // Feedback inmediato del disparo (trazador visual): solo si de verdad puede
      // disparar (Seeker en Hunt) — el impacto real lo decide el servidor.
      if (action === ActionKind.CATCH) {
        const st = worldStore.getState();
        if (st.local.role === 'seeker' && st.phase === 'hunt') signalLocalShot();
      }

      sockets.sendInput({ moveX, moveZ, aimX, aimY, aimZ, pose, action });
    }, TICK_MS);

    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [sockets]);
}
