/**
 * Players — render de TODOS los avatares (camaleones) con un solo `InstancedMesh`
 * (una draw call), como pide el prompt ("InstancedMesh para elementos duplicados").
 *
 * Skill `r3f-rendering`: cero `setState` por frame; en `useFrame` se MUTAN las
 * matrices/colores de instancia leyendo `worldStore` vía `getState()`; geometría y
 * material se memoizan; objetos scratch de módulo (sin asignar por frame). El jugador
 * local usa su posición PREDICHA; los remotos se INTERPOLAN en el pasado.
 */
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { worldStore } from '../store/worldStore';
import { sampleRemote, INTERP_DELAY_MS } from '../hooks/interpolation';

const MAX_PLAYERS = 16;
const BODY_HALF_HEIGHT = 0.65;

// Scratch de ámbito de módulo: el render es monohilo y `useFrame` es síncrono.
const _obj = new THREE.Object3D();
const _color = new THREE.Color();

export function Players() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const geometry = useMemo(() => new THREE.CapsuleGeometry(0.4, 0.9, 4, 8), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.8 }), []);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const st = worldStore.getState();
    const renderTime = performance.now() - INTERP_DELAY_MS;
    let i = 0;

    // Jugador local: posición PREDICHA (responde al instante).
    const lp = st.local.pos;
    _obj.position.set(lp.x, lp.y + BODY_HALF_HEIGHT, lp.z);
    _obj.updateMatrix();
    mesh.setMatrixAt(i, _obj.matrix);
    const lc = st.local.color;
    _color.setRGB(lc.r / 255, lc.g / 255, lc.b / 255);
    mesh.setColorAt(i, _color);
    i++;

    // Remotos: INTERPOLADOS en el pasado (suave entre ticks de red).
    for (const e of st.remotes.values()) {
      if (i >= MAX_PLAYERS) break;
      sampleRemote(e.buffer, renderTime, e.render);
      _obj.position.set(e.render.x, e.render.y + BODY_HALF_HEIGHT, e.render.z);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
      _color.set((e.colorPacked >>> 8) & 0xffffff); // 0xRRGGBBAA → 0xRRGGBB
      mesh.setColorAt(i, _color);
      i++;
    }

    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, MAX_PLAYERS]}
      castShadow
      receiveShadow
    />
  );
}
