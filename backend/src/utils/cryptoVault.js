/**
 * cryptoVault.js
 *
 * AES-256-GCM symmetric encryption for sensitive credentials stored in the
 * database (Dejavoo auth keys, HPP keys, Transact API keys, etc.).
 *
 * Storage format: `iv:tag:ciphertext` (all hex).
 *
 * Usage:
 *   import { encrypt, decrypt, mask } from '../utils/cryptoVault.js';
 *   const enc = encrypt('my-secret-key');
 *   const plain = decrypt(enc);
 *   mask(plain)  // → "••••••••last4"
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

function loadKey() {
  const raw = process.env.DEJAVOO_VAULT_KEY || '';
  if (!raw) {
    console.warn('[cryptoVault] No DEJAVOO_VAULT_KEY set — using ephemeral dev key. Set one in .env for production.');
    return crypto.createHash('sha256').update('storv-dev-vault-key-change-me').digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

const KEY = loadKey();

export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext) {
  if (!ciphertext) return null;
  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[cryptoVault] decrypt failed:', err.message);
    return null;
  }
}

export function mask(plaintext, visible = 4) {
  if (!plaintext) return '';
  const s = String(plaintext);
  if (s.length <= visible) return '•'.repeat(s.length);
  return '•'.repeat(Math.min(8, s.length - visible)) + s.slice(-visible);
}
