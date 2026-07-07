/**
 * Utility for safe browser haptic feedback (vibration API).
 * Includes sanity checks to avoid throwing errors on unsupported browsers/devices.
 */

export const HapticPattern = {
  LIGHT_TAP: 10,
  MEDIUM_TAP: 25,
  HEAVY_TAP: 50,
  SCAN_START: [20, 30, 20],
  SCAN_SUCCESS: [40, 50, 40],
  SUCCESS_LONG: [60, 40, 60],
  ERROR_PATTERN: [120, 80, 120],
  TOCK: [10, 40, 10]
};

export function triggerHaptic(pattern: number | number[] = HapticPattern.LIGHT_TAP) {
  if (typeof window !== 'undefined') {
    const enabled = window.localStorage.getItem('haptics_enabled');
    if (enabled === 'false') {
      return;
    }
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      // Ignored: device might not have vibration motor or permission is denied
    }
  }
}
