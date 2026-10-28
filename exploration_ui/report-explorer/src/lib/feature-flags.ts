/**
 * Feature flags configuration
 * 
 * IMPORTANT: For production deployment, set ENABLE_EXTERNAL_VERIFICATION_LINKS to false
 * to disable external verification links
 */

const FEATURE_FLAGS = {
  // Set to false in production to disable external verification links
  ENABLE_EXTERNAL_VERIFICATION_LINKS: false,
} as const;

/**
 * Check if external verification links should be displayed
 */
export function isExternalVerificationEnabled(): boolean {
  return FEATURE_FLAGS.ENABLE_EXTERNAL_VERIFICATION_LINKS;
}

/**
 * Get all feature flags for client-side use
 */
export function getFeatureFlags() {
  return {
    externalVerificationEnabled: isExternalVerificationEnabled(),
  };
}