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
 *  - SILBIDO (V1-H rework): 'T' = el Hider silba MANUALMENTE y da al Seeker una
 *    pista posicional (útil en el mapa grande). Gating local por UX (rol/fase +
 *    cooldown de 2 s); la validación autoritativa es del servidor.
 *
 * Skill `r3f-rendering`: teclas y pose viven en closures/refs (NO estado de React);
 * cero re-render por tick. El envío + predicción ocurren en `sendInput`.
 */
import { useEffect } from 'react';
import { ActionKind } from '@mecha/shared';
import { POSE_COUNT } from '@mecha/sim';
import { lookState, consumePendingShot } from '@/features/canvas-3d/hooks/useMouseLook';
import { signalLocalShot } from '@/features/canvas-3d/components/ShotTracers';
import { worldStore } from '@/features/canvas-3d/store/worldStore';
import { audio } from '@/features/canvas-3d/audio/engine';
import type { GameSockets } from './useGameSockets';

const TICK_MS = 1000 / 30;
const WHISTLE_COOLDOWN_MS = 2000; // espejo UX del cooldown autoritativo del servidor

export function useLocalInput(sockets: GameSockets): void {
  useEffect(() => {
    const keys = new Set<string>();
    let pose = 0; // pose deseada (cicla con 'R'); el servidor la sanea/valida
    let pendingKeyShots = 0; // disparos encolados con 'F' (flanco de tecla)
    let nextWhistleAt = 0; // cooldown local del silbido (UX; el servidor limita igual)

    const down = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (k === 'r' && !e.repeat) pose = (pose + 1) % POSE_COUNT; // cicla las 6 poses
      if (k === 'f' && !e.repeat) pendingKeyShots++;
      // V1-H rework: silbido manual del Hider — gating local por UX; el servidor
      // valida autoritativamente (rol, fase hunt, cooldown).
      if (k === 't' && !e.repeat) {
        const st = worldStore.getState();
        const now = performance.now();
        if (
          st.local.role === 'hider' &&
          !st.local.caught &&
          st.phase === 'hunt' &&
          now >= nextWhistleAt
        ) {
          nextWhistleAt = now + WHISTLE_COOLDOWN_MS;
          sockets.sendControl({ type: 'whistle' });
        }
      }
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

      // Feedback inmediato del disparo (trazador visual + SFX): solo si de verdad
      // puede disparar (Seeker en Hunt) — el impacto real lo decide el servidor.
      if (action === ActionKind.CATCH) {
        const st = worldStore.getState();
        if (st.local.role === 'seeker' && st.phase === 'hunt') {
          signalLocalShot();
          audio.playShot(); // V1-H
        }
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
