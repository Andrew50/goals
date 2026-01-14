export const AUTH_FRIENDLY_MESSAGES = {
  invalidCredentials: 'Incorrect username/password',
  serverError: 'Server error',
} as const;

/**
 * Maps potentially-technical Axios (or Axios-like) errors into a very small set of
 * non-technical, user-facing messages for auth flows.
 */
export function getAuthFriendlyErrorMessage(err: unknown): string {
  const anyErr = err as any;
  const status: number | undefined = anyErr?.status ?? anyErr?.response?.status;

  // Treat common auth/user-input HTTP statuses as "invalid credentials".
  if (status === 400 || status === 401 || status === 403 || status === 409) {
    return AUTH_FRIENDLY_MESSAGES.invalidCredentials;
  }

  // Network errors, timeouts, 5xx, and anything else.
  return AUTH_FRIENDLY_MESSAGES.serverError;
}


