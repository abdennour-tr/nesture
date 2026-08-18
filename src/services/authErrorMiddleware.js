/**
 * Authentication Error Middleware
 *
 * Intercepts, logs, and maps auth-related errors securely.
 * Protects against credential enumeration and details leakage by returning
 * generalized messages to the UI, while maintaining detailed developer/debug logs.
 */

/**
 * Maps and logs authentication errors.
 * @param {Error|object} error - The caught error object.
 * @param {object} [context] - Additional debugging context (e.g., email, role).
 * @returns {Error} The sanitized Error object for user consumption.
 */
export function handleAuthError(error, context = {}) {
  // 1. Log detailed error details for developers (backend-style logs)
  console.error('[AUTH_INTERNAL_ERROR]', {
    timestamp: new Date().toISOString(),
    message: error?.message || String(error),
    status: error?.status,
    code: error?.code,
    context,
    stack: error?.stack,
    rawError: error
  });

  // 2. Network / Connectivity Error Detection
  const isNetworkError =
    !navigator.onLine ||
    error?.message?.includes('Failed to fetch') ||
    error?.message?.toLowerCase().includes('network') ||
    error?.message?.includes('TypeError') ||
    error?.status === 0;

  if (isNetworkError) {
    return new Error('Network error. Please check your internet connection and try again.');
  }

  // 3. Unified Security-Hardened Error Message
  // Maps wrong credentials, non-existent users, role mismatches, and format errors.
  return new Error('Incorrect email or password.');
}
