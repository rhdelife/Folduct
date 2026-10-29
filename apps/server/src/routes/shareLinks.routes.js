const express = require('express');
const { ShareLink, Project, Member, AuditLog } = require('../models');
const requireAuth = require('../middleware/auth.middleware');
const { hashToken } = require('../utils/crypto');
const httpError = require('../utils/httpError');

const router = express.Router();

// 링크를 받은 사람이 로그인한 뒤 호출합니다. 이미 멤버면 권한을 낮추지 않습니다.
router.post('/:token/accept', requireAuth, async (req, res) => {
  const link = await ShareLink.findOne({ tokenHash: hashToken(req.params.token), revokedAt: null, expiresAt: { $gt: new Date() } });
  const project = link && (await Project.findOne({ _id: link.projectId, deletedAt: null }));
  if (!project) throw httpError(404, '만료되었거나 취소된 링크입니다.');

  const existing = await Member.findOne({ projectId: project._id, userId: req.userId });
  if (existing) return res.json({ data: { projectId: project._id, role: existing.role } });

  await Member.create({ projectId: project._id, userId: req.userId, role: link.role });
  await AuditLog.create({ projectId: project._id, userId: req.userId, action: 'shareLink.accept', detail: { linkId: link._id } });
  res.status(201).json({ data: { projectId: project._id, role: link.role } });
});

module.exports = router;
