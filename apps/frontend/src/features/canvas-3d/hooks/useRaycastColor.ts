/**
 * useRaycastColor — el "cuentagotas". Al pulsar 'E', lanza un Raycaster desde el
 * centro de la cámara al entorno, lee el color del material impactado y lo aplica al
 * avatar local (optimista) + lo envía al servidor (autoritativo valida fase Prep + lock).
 *
 * Skill `r3f-rendering`: Raycaster y Vector2 reutilizados (sin asignar por uso); no es
 * lógica de render-loop (responde a un evento de teclado), no dispara setState por frame.
 * Debe usarse DENTRO del <Canvas> (usa `useThree`).
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldStore } from '../store/worldStore';

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0); // centro de la pantalla (mira)

export function useRaycastColor(
  sendControl: (msg: Record<string, unknown>) => void,
): void {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'e') return;
      _raycaster.setFromCamera(_center, camera);
      const hits = _raycaster.intersectObjects(scene.children, true);
      const hit = hits.find((h) => (h.object as Partial<THREE.Mesh>).material);
      if (!hit) return;
      const material = (hit.object as THREE.Mesh).material;
      const mat = (Array.isArray(material) ? material[0] : material) as THREE.MeshStandardMaterial;
      if (!mat?.color) return;
      const r = Math.round(mat.color.r * 255);
      const g = Math.round(mat.color.g * 255);
      const b = Math.round(mat.color.b * 255);
      worldStore.getState().local.color.setMut(r, g, b, 255); // optimista
      sendControl({ type: 'color', r, g, b, a: 255 }); // autoritativo
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera, scene, sendControl]);
}
