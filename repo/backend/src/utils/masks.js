/**
 * Mask a phone number based on the caller's role.
 * Platform Ops see the full value; everyone else sees only the last 4 digits.
 */
function maskPhone(phone, userRole) {
  if (userRole === 'platform_ops') return phone;
  if (!phone || phone.length < 4) return '****';
  return '****' + phone.slice(-4);
}

/**
 * Mask an email address.
 * Platform Ops see the full value; others see a partial mask.
 */
function maskEmail(email, userRole) {
  if (userRole === 'platform_ops') return email;
  if (!email) return '****';
  const atIdx = email.indexOf('@');
  if (atIdx <= 1) return '****' + email.slice(atIdx);
  return email[0] + '***' + email.slice(atIdx);
}

module.exports = { maskPhone, maskEmail };
