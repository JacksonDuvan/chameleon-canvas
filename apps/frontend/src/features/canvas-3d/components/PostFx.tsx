/**
 * PostFx — cadena de posprocesado (playtest r6: "gráficos mucho mejores").
 *
 *   RenderPass → N8AO (oclusión ambiental) → Bloom + SMAA + Viñeta + Tone mapping
 *
 *  - OCLUSIÓN AMBIENTAL: sombra de contacto en esquinas, bajo los muebles y donde
 *    el muñeco toca el suelo/pared. Es lo que más "asienta" una escena low-poly.
 *  - BLOOM: solo lo MUY brillante (bombillas emisivas, fogonazo) — umbral alto para
 *    no lavar los colores que el Hider tiene que igualar.
 *  - SMAA en vez de MSAA: el buffer HDR intermedio no admite el MSAA del canvas.
 *  - TONE MAPPING Neutral al FINAL de la cadena (el renderer va en NoToneMapping):
 *    los efectos trabajan en HDR lineal.
 *
 * Usa la librería base `postprocessing` (no el wrapper de R3F: su v3 exige
 * fiber ≥9.7). El compositor toma el render con `useFrame(…, 1)`: prioridad > 0
 * desactiva el render automático de R3F. Skill `r3f-rendering`: todo se crea una
 * vez (useMemo), cero setState y cero asignaciones por frame.
 *
 * Con `enabled=false` (modo "gráficos bajos") no monta nada: R3F renderiza directo.
 */
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/** Exposición del tone mapping en el modo SIN posprocesado (renderer directo). */
export const DIRECT_EXPOSURE = 1.05;

export function PostFx({ enabled }: { enabled: boolean }) {
  return enabled ? <Composer /> : <DirectRender />;
}

/** Modo bajo: el renderer hace el tone mapping él mismo. */
function DirectRender() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = DIRECT_EXPOSURE;
  }, [gl]);
  return null;
}

function Composer() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const composer = useMemo(() => {
    const c = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    c.addPass(new RenderPass(scene, camera));

    const ao = new N8AOPostPass(scene, camera, 1, 1);
    ao.configuration.aoRadius = 1.1; // m: esquinas de cuarto y contacto de muebles
    ao.configuration.distanceFalloff = 1;
    ao.configuration.intensity = 2.6;
    ao.configuration.color = new THREE.Color('#141b24'); // sombra fría, no negro puro
    ao.configuration.halfRes = true; // mitad de resolución + upsampling por profundidad
    ao.setQualityMode('Medium');
    c.addPass(ao);

    const bloom = new BloomEffect({
      // Por ENCIMA de un blanco a pleno sol (~1.9): si no, el Hider sin pintar (blanco)
      // brillaba como una bombilla. Solo bombillas (4×), sol y fogonazo superan el umbral.
      luminanceThreshold: 2.4,
      luminanceSmoothing: 0.2,
      intensity: 0.55,
      mipmapBlur: true,
      radius: 0.7,
    });
    const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    c.addPass(new EffectPass(camera, bloom, smaa, vignette, tone));
    return c;
  }, [gl, scene, camera]);

  useEffect(() => {
    // Los efectos trabajan en HDR lineal: el tone mapping lo hace el último pase.
    const prev = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;
    return () => {
      gl.toneMapping = prev;
      composer.dispose();
    };
  }, [gl, composer]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
  }, [composer, size.width, size.height]);

  // Prioridad 1: sustituye al render automático de R3F.
  useFrame((_, delta) => {
    composer.render(delta);
  }, 1);

  return null;
}
