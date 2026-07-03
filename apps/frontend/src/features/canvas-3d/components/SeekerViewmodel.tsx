/**
 * SeekerViewmodel — el ARMA en primera persona del Seeker (V1-G v2, fiel a las
 * capturas del original: el blaster asoma por la esquina inferior derecha).
 * Solo presentación: el disparo real es un comando de input que resuelve el servidor.
 *
 * Sin `createPortal` a la cámara: un grupo en la raíz copia posición+orientación de
 * la cámara cada frame (funciona aunque la cámara no cuelgue del grafo de escena) y
 * el arma vive como hijo con offset local fijo.
 *
 * Skill `r3f-rendering`: mutación de refs en `useFrame`, geometrías/materiales
 * memoizados, cero setState. `userData.noSample`: ni el cuentagotas ni el trazador
 * deben "ver" el arma (está pegada a la cámara).
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { worldStore } from '../store/worldStore';

const NO_SAMPLE = { noSample: true };

export function SeekerViewmodel() {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null!);

  const { bodyGeo, barrelGeo, gripGeo, dark, accent } = useMemo(
    () => ({
      bodyGeo: new THREE.BoxGeometry(0.09, 0.11, 0.34),
      barrelGeo: new THREE.CylinderGeometry(0.028, 0.028, 0.26, 10),
      gripGeo: new THREE.BoxGeometry(0.07, 0.16, 0.09),
      dark: new THREE.MeshStandardMaterial({ color: '#5a6570', roughness: 0.5, metalness: 0.3 }),
      accent: new THREE.MeshStandardMaterial({ color: '#ffd54a', roughness: 0.5, metalness: 0.2 }),
    }),
    [],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const st = worldStore.getState();
    g.visible = st.local.role === 'seeker' && st.phase === 'hunt' && !st.local.caught;
    if (!g.visible) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={group} visible={false}>
      {/* Offset local: esquina inferior derecha, apuntando al frente (-Z local). */}
      <group position={[0.36, -0.3, -0.6]} rotation={[0, -0.06, 0]} scale={0.85}>
        <mesh geometry={bodyGeo} material={dark} userData={NO_SAMPLE} />
        <mesh
          geometry={barrelGeo}
          material={accent}
          rotation-x={Math.PI / 2}
          position={[0, 0.015, -0.27]}
          userData={NO_SAMPLE}
        />
        <mesh geometry={gripGeo} material={dark} position={[0, -0.12, 0.09]} rotation-x={0.25} userData={NO_SAMPLE} />
      </group>
    </group>
  );
}
