/**
 * Re-export of the heat ramp, so globe-side code can `import { heatColor } from
 * './heat'` without reaching across into `@/lib/geo`. The canonical definition
 * — and the one non-globe subsystems should import — lives in
 * `@/lib/geo/heat`.
 */

export {
  HEAT_COLORS,
  HEAT_INTENSITY,
  PULSING_HEAT,
  heatColor,
  heatIntensity,
  heatPulses,
  BRASS,
  BRASS_BRIGHT,
  VOID,
} from '@/lib/geo/heat';
