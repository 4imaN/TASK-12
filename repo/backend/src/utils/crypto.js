const crypto = require('crypto');
const IV_LENGTH = 16;

function getKey() {
  const raw = process.env.PHONE_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      'PHONE_ENCRYPTION_KEY must be set (minimum 16 characters) for phone number encryption. ' +
      'Run `npm run bootstrap` to generate it, or set it manually in .env.'
    );
  }
  if (raw === 'change-this-to-a-32-char-secret!') {
    throw new Error(
      'PHONE_ENCRYPTION_KEY is still set to the placeholder value. ' +
      'Run `npm run bootstrap` to generate a real key, or replace the value in .env.'
    );
  }
  return raw.slice(0, 32).padEnd(32, '0');
}

function encrypt(text) {
  if (!text) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text) return null;
  try {
    const parts = text.split(':');
    if (parts.length !== 2) return text; // Legacy plaintext
    const key = getKey();
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch {
    return text; // Fallback for legacy data
  }
}

module.exports = { encrypt, decrypt };
