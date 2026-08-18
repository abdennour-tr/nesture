// Strict regex patterns for security validation
export const NAME_REGEX = /^[a-zA-ZÀ-ÿ\s'-]+$/;
export const NICKNAME_REGEX = /^[a-zA-Z0-9_-]+$/;
// RFC 5322 compliant simple email regex
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Sanitizes input text: trims spacing, strips HTML/XSS/Script tags, and truncates to maxLength.
 * @param {string} value - The input text to sanitize.
 * @param {number} [maxLength=255] - The maximum allowed character length.
 * @returns {string} The trimmed, tag-stripped, and truncated string.
 */
export function sanitizeInput(value, maxLength = 255) {
  if (typeof value !== 'string') return '';
  let sanitized = value.trim();
  // Strip HTML/script tags
  sanitized = sanitized.replace(/<[^>]*>?/gm, '');
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }
  return sanitized;
}

/**
 * Validates a name string.
 * Must be 2-50 characters, only standard letters, spaces, hyphens, and apostrophes.
 * @param {string} name - Name to validate.
 * @param {string} [fieldName='Name'] - Field label for custom error messages.
 * @returns {string} The trimmed name.
 */
export function validateName(name, fieldName = 'Name') {
  if (!name) {
    throw new Error(`${fieldName} is required.`);
  }
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 50) {
    throw new Error(`${fieldName} must be between 2 and 50 characters.`);
  }
  if (!NAME_REGEX.test(trimmed)) {
    throw new Error(`${fieldName} contains invalid characters. Only letters, spaces, hyphens, and apostrophes are allowed.`);
  }
  return trimmed;
}

/**
 * Validates a nickname string.
 * Must be 2-30 characters, alphanumeric with hyphens/underscores.
 * @param {string} nickname - Nickname to validate.
 * @returns {string} The trimmed nickname.
 */
export function validateNickname(nickname) {
  if (!nickname) {
    throw new Error('Nickname is required.');
  }
  const trimmed = nickname.trim();
  if (trimmed.includes('@')) {
    throw new Error('Nickname cannot contain "@" or be an email address.');
  }
  if (trimmed.length < 2 || trimmed.length > 30) {
    throw new Error('Nickname must be between 2 and 30 characters.');
  }
  if (!NICKNAME_REGEX.test(trimmed)) {
    throw new Error('Nickname contains invalid characters. Only letters, numbers, underscores, and hyphens are allowed.');
  }
  return trimmed;
}

/**
 * Validates an email string according to RFC standards.
 * @param {string} email - Email address to validate.
 * @returns {string} The trimmed lowercase email.
 */
export function validateEmail(email) {
  if (!email) {
    throw new Error('Email address is required.');
  }
  const trimmed = email.trim();
  if (trimmed.length > 255) {
    throw new Error('Email must be 255 characters or less.');
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    throw new Error('Please enter a valid email address.');
  }
  return trimmed.toLowerCase();
}

/**
 * Validates that a date is not in the future.
 * @param {string} dateStr - Date string (YYYY-MM-DD).
 * @returns {string} The date string if valid.
 */
export function validateDateNotFuture(dateStr) {
  if (!dateStr) {
    throw new Error('Date is required.');
  }
  const dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) {
    throw new Error('Please enter a valid date.');
  }
  const today = new Date();
  // Set time of today to end of day to allow same day registration
  today.setHours(23, 59, 59, 999);
  if (dateObj > today) {
    throw new Error('Date cannot be in the future.');
  }
  return dateStr;
}

/**
 * Validates child/user age (0 to 80 years).
 * @param {number|string} age - Age to check.
 * @returns {number} The validated age integer.
 */
export function validateAgeRange(age) {
  const parsed = parseInt(age, 10);
  if (isNaN(parsed) || parsed < 0 || parsed > 80) {
    throw new Error('Age must be a number between 0 and 80.');
  }
  return parsed;
}

/**
 * Validates a password length.
 * @param {string} password - Password to check.
 * @returns {string} The validated password.
 */
export function validatePassword(password, isLearner = false) {
  if (!password) {
    throw new Error('Password is required.');
  }
  const minLength = isLearner ? 4 : 8;
  if (password.length < minLength) {
    throw new Error(`Password must be at least ${minLength} characters.`);
  }
  if (password.length > 72) {
    throw new Error('Password must be 72 characters or less.');
  }
  return password;
}
