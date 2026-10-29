const { Project, Member, User, Workspace, WorkspaceVersion, Scene, ShareLink, AuditLog } = require('../models');
const audit = require('../services/audit.service');
const { newToken, hashToken } = require('../utils/crypto');
const { limits, text, isObject } = require('../utils/validate');
const httpError = require('../utils/httpError');

// revision·projectId는 서버가 정합니다. 클라이언트가 보낸 값은 버립니다.
// shortcut: 작업면 안쪽 구조(카드·구역)는 검사하지 않음, 웹 앱 밖의 클라이언트가 생기면 validation.ts를 서버로 옮길 것
function workspaceContent(workspace) {
  if (!isObject(workspace)) throw httpError(400, 'workspace는 객체여야 합니다.');
  const { revision, projectId, ...content } = workspace;
  return content;
}

// ── 프로젝트 ──────────────────────────────────────────────

exports.list = async (req, res) => {
  const memberships = await Member.find({ userId: req.userId });
  const roleOf = new Map(memberships.map((m) => [m.projectId, m.role]));
  const projects = await Project.find({ _id: { $in: [...roleOf.keys()] }, deletedAt: null }).sort({ updatedAt: -1 });
  res.json({ data: projects.map((p) => ({ ...p.toJSON(), role: roleOf.get(p._id) })) });
};

// 로컬 프로젝트를 서버에 올리는 "공유하기"
exports.create = async (req, res) => {
  const name = text(req.body.name, limits.projectName);
  const coverColor = text(req.body.coverColor, limits.coverColor);
  if (!name) throw httpError(400, `프로젝트 이름은 1~${limits.projectName}자여야 합니다.`);
  if (!coverColor) throw httpError(400, '표지 색이 필요합니다.');
  const content = workspaceContent(req.body.workspace ?? {});

  // shortcut: 트랜잭션 없이 순서대로 만듦, 중간 실패 시 빈 프로젝트가 남을 수 있음. 레플리카셋 Mongo로 옮기면 session.withTransaction으로 묶을 것
  const project = await Project.create({ name, coverColor, ownerId: req.userId });
  await Member.create({ projectId: project._id, userId: req.userId, role: 'owner' });
  const workspace = await Workspace.create({ _id: project._id, revision: 1, content, updatedBy: req.userId });
  await WorkspaceVersion.create({ projectId: project._id, revision: 1, content, savedBy: req.userId });
  req.project = project;
  await audit.record(req, 'project.create');

  res.status(201).json({ data: { project, workspace, role: 'owner' } });
};

exports.get = async (req, res) => {
  res.json({ data: { ...req.project.toJSON(), role: req.role } });
};

exports.update = async (req, res) => {
  const changes = {};
  if (req.body.name !== undefined) {
    changes.name = text(req.body.name, limits.projectName);
    if (!changes.name) throw httpError(400, `프로젝트 이름은 1~${limits.projectName}자여야 합니다.`);
  }
  if (req.body.coverColor !== undefined) {
    changes.coverColor = text(req.body.coverColor, limits.coverColor);
    if (!changes.coverColor) throw httpError(400, '표지 색이 올바르지 않습니다.');
  }
  const project = await Project.findByIdAndUpdate(req.project._id, { $set: changes }, { new: true });
  await audit.record(req, 'project.update', changes);
  res.json({ data: project });
};

// 지우지 않고 숨깁니다. 작업면·장면·기록은 그대로 남습니다.
exports.remove = async (req, res) => {
  await Project.updateOne({ _id: req.project._id }, { $set: { deletedAt: new Date() } });
  await audit.record(req, 'project.delete');
  res.status(204).send();
};

// ── 작업면 ────────────────────────────────────────────────

exports.getWorkspace = async (req, res) => {
  res.json({ data: await Workspace.findById(req.project._id) });
};

exports.saveWorkspace = async (req, res) => {
  const { expectedRevision } = req.body;
  if (!Number.isInteger(expectedRevision)) throw httpError(400, 'expectedRevision(정수)이 필요합니다.');
  const content = workspaceContent(req.body.workspace);

  // revision이 같을 때만 덮어씁니다. 그 사이 다른 사람이 저장했으면 아무것도 바꾸지 않습니다.
  const workspace = await Workspace.findOneAndUpdate(
    { _id: req.project._id, revision: expectedRevision },
    { $set: { content, updatedBy: req.userId }, $inc: { revision: 1 } },
    { new: true },
  );
  if (!workspace) {
    const current = await Workspace.findById(req.project._id);
    return res.status(409).json({
      error: { message: '다른 사람이 먼저 저장했습니다. 최신 작업면을 불러온 뒤 다시 저장하세요.', currentRevision: current.revision },
    });
  }
  await WorkspaceVersion.create({ projectId: req.project._id, revision: workspace.revision, content, savedBy: req.userId });
  await audit.record(req, 'workspace.save', { revision: workspace.revision });
  res.json({ data: workspace });
};

exports.listVersions = async (req, res) => {
  const versions = await WorkspaceVersion.find({ projectId: req.project._id }, { content: 0 }).sort({ revision: -1 }).limit(100);
  res.json({ data: versions });
};

exports.getVersion = async (req, res) => {
  const version = await WorkspaceVersion.findOne({ projectId: req.project._id, revision: Number(req.params.revision) });
  if (!version) throw httpError(404, 'Version not found');
  res.json({ data: version });
};

// ── 장면 (추가만 가능) ─────────────────────────────────────

exports.listScenes = async (req, res) => {
  res.json({ data: await Scene.find({ projectId: req.project._id }).sort({ createdAt: -1 }) });
};

exports.createScene = async (req, res) => {
  const title = text(req.body.title, limits.sceneTitle);
  const { type, snapshot, assetManifest = [] } = req.body;
  if (!title) throw httpError(400, `장면 이름은 1~${limits.sceneTitle}자여야 합니다.`);
  if (!['pause', 'manual', 'safety'].includes(type)) throw httpError(400, '장면 종류가 올바르지 않습니다.');
  if (!isObject(snapshot)) throw httpError(400, 'snapshot은 객체여야 합니다.');
  if (!Array.isArray(assetManifest)) throw httpError(400, 'assetManifest는 배열이어야 합니다.');

  const current = await Workspace.findById(req.project._id);
  const scene = await Scene.create({
    projectId: req.project._id,
    title,
    type,
    sourceRevision: current.revision,
    snapshot: workspaceContent(snapshot),
    assetManifest,
    createdBy: req.userId,
  });
  await audit.record(req, 'scene.create', { sceneId: scene._id });
  res.status(201).json({ data: scene });
};

// ── 멤버 ──────────────────────────────────────────────────

exports.listMembers = async (req, res) => {
  const members = await Member.find({ projectId: req.project._id }).populate('userId', 'name email');
  res.json({ data: members.map((m) => ({ user: m.userId, role: m.role })) });
};

exports.addMember = async (req, res) => {
  const { role } = req.body;
  if (!['editor', 'viewer'].includes(role)) throw httpError(400, 'role은 editor 또는 viewer입니다.');
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const user = email && (await User.findOne({ email }));
  if (!user) throw httpError(404, '가입한 사용자가 아닙니다.');
  if (await Member.exists({ projectId: req.project._id, userId: user._id })) throw httpError(409, '이미 멤버입니다.');

  await Member.create({ projectId: req.project._id, userId: user._id, role });
  await audit.record(req, 'member.add', { userId: user._id, role });
  res.status(201).json({ data: { user, role } });
};

exports.updateMember = async (req, res) => {
  const { role } = req.body;
  if (!['editor', 'viewer'].includes(role)) throw httpError(400, 'role은 editor 또는 viewer입니다.');
  const member = await Member.findOne({ projectId: req.project._id, userId: req.params.userId });
  if (!member) throw httpError(404, 'Member not found');
  if (member.role === 'owner') throw httpError(400, '소유자의 권한은 바꿀 수 없습니다.');

  member.role = role;
  await member.save();
  await audit.record(req, 'member.update', { userId: member.userId, role });
  res.json({ data: { userId: member.userId, role } });
};

// 소유자는 다른 멤버를 내보낼 수 있고, 멤버는 스스로 나갈 수 있습니다.
exports.removeMember = async (req, res) => {
  const self = req.params.userId === req.userId;
  if (!self && req.role !== 'owner') throw httpError(403, 'owner 이상 권한이 필요합니다.');
  const member = await Member.findOne({ projectId: req.project._id, userId: req.params.userId });
  if (!member) throw httpError(404, 'Member not found');
  if (member.role === 'owner') throw httpError(400, '소유자는 프로젝트에서 나갈 수 없습니다.');

  await member.deleteOne();
  await audit.record(req, 'member.remove', { userId: member.userId });
  res.status(204).send();
};

// ── 공유 링크 (열람 전용) ─────────────────────────────────

exports.listShareLinks = async (req, res) => {
  res.json({ data: await ShareLink.find({ projectId: req.project._id }).sort({ createdAt: -1 }) });
};

exports.createShareLink = async (req, res) => {
  const days = req.body.expiresInDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw httpError(400, 'expiresInDays는 1~30입니다.');
  const token = newToken();
  const link = await ShareLink.create({
    tokenHash: hashToken(token),
    projectId: req.project._id,
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    createdBy: req.userId,
  });
  await audit.record(req, 'shareLink.create', { linkId: link._id });
  // 토큰 원문은 이 응답에서만 보입니다.
  res.status(201).json({ data: { ...link.toJSON(), token } });
};

exports.revokeShareLink = async (req, res) => {
  const link = await ShareLink.findOneAndUpdate(
    { _id: req.params.linkId, projectId: req.project._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  if (!link) throw httpError(404, 'Share link not found');
  await audit.record(req, 'shareLink.revoke', { linkId: link._id });
  res.status(204).send();
};

// ── 감사 기록 ─────────────────────────────────────────────

exports.listAudit = async (req, res) => {
  res.json({ data: await AuditLog.find({ projectId: req.project._id }).sort({ createdAt: -1 }).limit(100) });
};
