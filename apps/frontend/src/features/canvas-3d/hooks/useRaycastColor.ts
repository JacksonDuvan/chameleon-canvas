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
      const obj = hit.object as THREE.Mesh;

      // Preferir el color de referencia EXACTO que el servidor usa para puntuar el
      // camuflaje (`userData.refColor`, bytes sRGB del mapa compartido): así "color
      // absorbido == color de referencia" y absorber la superficie sube el score a tope.
      // Fallback (superficie sin etiqueta): el color del material convertido a sRGB.
      let r: number, g: number, b: number;
      const packed = obj.userData?.refColor as number | undefined;
      if (typeof packed === 'number') {
        r = (packed >>> 24) & 0xff;
        g = (packed >>> 16) & 0xff;
        b = (packed >>> 8) & 0xff;
      } else {
        const material = obj.material;
        const mat = (Array.isArray(material) ? material[0] : material) as THREE.MeshStandardMaterial;
        if (!mat?.color) return;
        const hex = mat.color.getHex(THREE.SRGBColorSpace); // lineal → bytes sRGB
        r = (hex >> 16) & 0xff;
        g = (hex >> 8) & 0xff;
        b = hex & 0xff;
      }
      worldStore.getState().local.color.setMut(r, g, b, 255); // optimista
      sendControl({ type: 'color', r, g, b, a: 255 }); // autoritativo
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera, scene, sendControl]);
}
