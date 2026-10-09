const MIN_STAFF_PIN_PEPPER_LENGTH = 32;
const LOCAL_STAFF_PIN_PEPPER =
  'local-only-staff-pin-pepper-change-before-production';

export class StaffSecurityConfigError extends Error {
  constructor() {
    super(
      `STAFF_PIN_PEPPER must be configured with at least ${MIN_STAFF_PIN_PEPPER_LENGTH} characters in production`,
    );
    this.name = 'StaffSecurityConfigError';
    this.code = 'staff_pin_pepper_not_configured';
    this.status = 503;
  }
}

export function resolveStaffPinPepper({ env = process.env } = {}) {
  const configured = String(env.STAFF_PIN_PEPPER || '');
  if (configured.length >= MIN_STAFF_PIN_PEPPER_LENGTH) return configured;

  if (String(env.NODE_ENV || '').toLowerCase() !== 'production') {
    const localFallback = String(env.SESSION_SECRET || configured);
    return localFallback.length >= MIN_STAFF_PIN_PEPPER_LENGTH
      ? localFallback
      : LOCAL_STAFF_PIN_PEPPER;
  }

  throw new StaffSecurityConfigError();
}

export function assertStaffSecurityConfig(options = {}) {
  resolveStaffPinPepper(options);
}
