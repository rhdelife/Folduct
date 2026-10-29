const { Project, Member } = require('../models');
const httpError = require('../utils/httpError');

const rank = { viewer: 1, editor: 2, owner: 3 };

// requireAuth 뒤에 씁니다. 모든 프로젝트 라우트의 권한 검사는 여기 한 곳에서만 합니다.
module.exports = (minRole) => async (req, res, next) => {
  const project = await Project.findOne({ _id: req.params.id, deletedAt: null });
  const member = project && (await Member.findOne({ projectId: project._id, userId: req.userId }));
  // 멤버가 아니면 프로젝트가 있는지도 알려주지 않습니다.
  if (!member) throw httpError(404, 'Project not found');
  if (rank[member.role] < rank[minRole]) throw httpError(403, `${minRole} 이상 권한이 필요합니다.`);
  req.project = project;
  req.role = member.role;
  next();
};
