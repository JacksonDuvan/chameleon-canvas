/**
 * Re-exporta los helpers PUROS de interpolación. La lógica vive en `./interpolation`
 * (testeada fuera de React) y la interpolación por-frame ocurre dentro de `useFrame`
 * en `Players` (MechaMesh.tsx), no en un hook aparte. Skills `authoritative-netcode`
 * + `r3f-rendering`.
 */
export {
  sampleRemote,
  pushRemoteSnapshot,
  INTERP_DELAY_MS,
  MAX_REMOTE_BUFFER,
} from './interpolation';
