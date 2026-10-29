const { Session } = require('../models');
const { hashToken } = require('../utils/crypto');
const httpError = require('../utils/httpError');

module.exports = async function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw httpError(401, '로그인이 필요합니다.');
  const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) throw httpError(401, '로그인이 만료되었습니다.');
  req.userId = session.userId;
  req.tokenHash = session.tokenHash;
  next();
};
