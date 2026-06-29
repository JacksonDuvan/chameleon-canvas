/**
 * Scene — raíz del mundo 3D (contenido del <Canvas>). Compone el escenario y los
 * avatares. No posee estado de juego: lee `worldStore` (skill `r3f-rendering` +
 * `hexagonal-vertical-slicing`: el render es un adaptador driven).
 */
import { Environment } from './Environment';
import { Players } from './MechaMesh';

export function Scene() {
  return (
    <>
      <Environment />
      <Players />
    </>
  );
}
