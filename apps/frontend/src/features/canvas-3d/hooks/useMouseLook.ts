/**
 * useMouseLook — mouse-look con Pointer Lock (V1-C). Captura el ratón al hacer clic en
 * el canvas y acumula yaw/pitch en un estado de MÓDULO mutable (`lookState`), fuera de
 * React: lo leen a frame-rate la cámara (`CameraRig`) y a tick-rate el input
 * (`useLocalInput`) sin re-render alguno (skill `r3f-rendering`).
 *
 * También encola los DISPAROS del Seeker (click = 1 disparo, `consumePendingShot`). El
 * único estado React-visible es `pointerLocked` (LENTO, hint del HUD) vía worldStore.
 *
 * Convención de ejes (three.js): yaw=0 mira hacia −Z; el yaw DECRECE al mover el ratón
 * a la derecha (giro horario visto desde arriba). forward = (−sin yaw, 0, −cos yaw).
 * El pitch sube con el ratón hacia arriba y se clampa (±~70°).
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { worldStore } from '../store/worldStore';

const SENSITIVITY = 0.0022; // rad / px
const PITCH_LIMIT = 1.2; // ~69°

/** Estado de mira compartido (mutable, transitorio). yaw/pitch en radianes. */
export const lookState = { yaw: 0, pitch: 0 };

/**
 * Disparos pendientes (contador, no flag): cada click con el ratón capturado encola UN
 * disparo; el bucle de input (30 Hz) los consume de uno en uno. Así un click rápido
 * entre ticks NUNCA se pierde y mantener pulsado NO ametralla (1 click = 1 disparo,
 * como el original; la munición la lleva el servidor).
 */
let pendingShots = 0;
export function consumePendingShot(): boolean {
  if (pendingShots <= 0) return false;
  pendingShots--;
  return true;
}

/** Vector adelante horizontal derivado del yaw (sin asignar: escribe en out). */
export function forwardFromYaw(out: { x: number; z: number }): void {
  out.x = -Math.sin(lookState.yaw);
  out.z = -Math.cos(lookState.yaw);
}

export function useMouseLook(): void {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;

    const onClick = (): void => {
      if (document.pointerLockElement === canvas) return;
      // Chrome bloquea re-capturar ~1 s tras salir con ESC: el request puede fallar.
      // Capturamos el rechazo (el HUD sigue mostrando el hint mientras no haya lock).
      const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {
        /* re-lock denegado (cooldown del navegador): reintenta con otro click */
      });
    };
    const onLockChange = (): void => {
      const locked = document.pointerLockElement === canvas;
      worldStore.setState({ pointerLocked: locked });
      if (!locked) pendingShots = 0; // al soltar el lock no queda disparo en cola
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) return;
      lookState.yaw -= e.movementX * SENSITIVITY;
      lookState.pitch -= e.movementY * SENSITIVITY;
      if (lookState.pitch > PITCH_LIMIT) lookState.pitch = PITCH_LIMIT;
      if (lookState.pitch < -PITCH_LIMIT) lookState.pitch = -PITCH_LIMIT;
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button === 0 && document.pointerLockElement === canvas) pendingShots++;
    };

    canvas.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      pendingShots = 0;
    };
  }, [gl]);
}
