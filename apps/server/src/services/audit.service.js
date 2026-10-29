const { AuditLog } = require('../models');

exports.record = (req, action, detail = {}) =>
  AuditLog.create({ projectId: req.project._id, userId: req.userId, action, detail });
