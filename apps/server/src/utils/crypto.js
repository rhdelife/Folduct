const { randomBytes, scrypt, timingSafeEqual, createHash } = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}

// 토큰 원문은 클라이언트에게 한 번만 주고, DB에는 해시만 저장합니다.
const newToken = () => randomBytes(32).toString('base64url');
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

module.exports = { hashPassword, verifyPassword, newToken, hashToken };
