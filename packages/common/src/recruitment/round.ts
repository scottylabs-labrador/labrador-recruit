/**
 * Every number this package publishes goes through the same rounding, so a
 * committee lead reading a mean and a reviewer reading a review score never see
 * two different renderings of the same arithmetic. Two decimals is the display
 * precision the interface uses; rounding here rather than at render time keeps
 * the stored number and the shown number identical.
 */
export function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
