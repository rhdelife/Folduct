const { User, Session } = require('../models');
const { hashPassword, verifyPassword, newToken, hashToken } = require('../utils/crypto');
const { limits, text } = require('../utils/validate');
const httpError = require('../utils/httpError');

const SESSION_DAYS = 30;

async function issueSession(userId) {
  const token = newToken();
  await Session.create({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}

exports.register = async (req, res) => {
  const email = text(req.body.email, limits.email)?.toLowerCase();
  const name = text(req.body.name, limits.userName);
  const { password } = req.body;
  if (!email || !email.includes('@')) throw httpError(400, '이메일이 올바르지 않습니다.');
  if (!name) throw httpError(400, `이름은 1~${limits.userName}자여야 합니다.`);
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw httpError(400, '비밀번호는 8자 이상이어야 합니다.');
  }
  if (await User.exists({ email })) throw httpError(409, '이미 가입한 이메일입니다.');

  const user = await User.create({ email, name, passwordHash: await hashPassword(password) });
  res.status(201).json({ data: { token: await issueSession(user._id), user } });
};

exports.login = async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const { password } = req.body;
  const user = email && (await User.findOne({ email }));
  // 어느 쪽이 틀렸는지 알려주지 않습니다.
  if (!user || typeof password !== 'string' || !(await verifyPassword(password, user.passwordHash))) {
    throw httpError(401, '이메일 또는 비밀번호가 맞지 않습니다.');
  }
  res.json({ data: { token: await issueSession(user._id), user } });
};

exports.logout = async (req, res) => {
  await Session.deleteOne({ tokenHash: req.tokenHash });
  res.status(204).send();
};

exports.me = async (req, res) => {
  res.json({ data: await User.findById(req.userId) });
};
