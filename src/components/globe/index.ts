/**
 * MERIDIAN globe engine — public surface.
 *
 * Page shells want `GlobeStage`. Everything else here is exported for
 * composition and testing, not because you need it.
 */

export { GlobeStage, default as default } from './GlobeStage';
export type { GlobeStageProps } from './GlobeStage';

export { Globe, GlobeCanvas, GlobeScene } from './Globe';
export type { GlobeProps, GlobeCanvasProps } from './Globe';

export { GlobeFallback } from './GlobeFallback';
export type { GlobeFallbackProps, GlobeFallbackKind } from './GlobeFallback';

export { Earth } from './Earth';
export { Atmosphere } from './Atmosphere';
export { Starfield } from './Starfield';
export { BeaconField } from './BeaconField';
export { BeaconPicker } from './BeaconPicker';
export { CameraRig, MIN_DISTANCE, MAX_DISTANCE } from './CameraRig';
export { Effects, detectQualityCeiling } from './Effects';

export {
  HEAT_COLORS,
  HEAT_INTENSITY,
  heatColor,
  heatIntensity,
  heatPulses,
} from './heat';

export { GEO_LAYERS, loadGeoLayer, useGeoLayer } from './useGeoLayer';
export { useReducedMotion } from './useReducedMotion';
export { useSunDate, useSunDirection } from './useSun';
export { BeaconRegistry, hash01, facesCamera } from './beaconState';
export type { BeaconEntry } from './beaconState';
