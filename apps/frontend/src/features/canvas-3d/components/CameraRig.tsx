/**
 * CameraRig — cámara en tercera persona que SIGUE al jugador local, de modo que tu
 * avatar queda siempre centrado (resuelve la confusión de "¿cuál cápsula soy yo?").
 *
 * Skill `r3f-rendering`: muta la cámara DENTRO de `useFrame` (jamás setState por frame);
 * lee la posición PREDICHA del local vía `getState()` transitorio; usa scratch de
 * módulo (sin asignar por frame); el suavizado depende de `delta` (estable ante FPS).
 */
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldStore } from '../store/worldStore';

const OFFSET = new THREE.Vector3(0, 12, 12); // vista aérea-trasera
const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  useFrame((_, delta) => {
    const lp = worldStore.getState().local.pos;
    _target.set(lp.x, lp.y + 1, lp.z);
    _desired.copy(_target).add(OFFSET);
    // Suavizado exponencial independiente de los FPS.
    camera.position.lerp(_desired, 1 - Math.pow(0.0015, delta));
    camera.lookAt(_target);
  });
  return null;
}
