const mongoose = require('mongoose');
const { idField, schemaOptions } = require('./base');

const { Schema } = mongoose;
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

const roles = ['owner', 'editor', 'viewer'];

const User = model('User', new Schema({
  _id: idField,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
}, schemaOptions(['passwordHash'])));

const Session = model('Session', new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 }, // TTL 인덱스: 만료되면 Mongo가 지웁니다.
}, schemaOptions()));

const Project = model('Project', new Schema({
  _id: idField,
  name: { type: String, required: true },
  coverColor: { type: String, required: true },
  ownerId: { type: String, required: true },
  deletedAt: { type: Date, default: null }, // soft delete
}, schemaOptions()));

const memberSchema = new Schema({
  projectId: { type: String, required: true },
  userId: { type: String, required: true, ref: 'User' },
  role: { type: String, enum: roles, required: true },
}, schemaOptions());
memberSchema.index({ projectId: 1, userId: 1 }, { unique: true });
const Member = model('Member', memberSchema);

// _id = projectId. revision은 서버만 올립니다.
const Workspace = model('Workspace', new Schema({
  _id: { type: String },
  revision: { type: Number, required: true },
  content: { type: Schema.Types.Mixed, required: true },
  updatedBy: { type: String, required: true },
}, { ...schemaOptions(), minimize: false }));

// 저장할 때마다 남기는 기록. 수정·삭제 API가 없습니다.
const versionSchema = new Schema({
  projectId: { type: String, required: true },
  revision: { type: Number, required: true },
  content: { type: Schema.Types.Mixed, required: true },
  savedBy: { type: String, required: true },
}, { ...schemaOptions(), minimize: false });
versionSchema.index({ projectId: 1, revision: -1 }, { unique: true });
const WorkspaceVersion = model('WorkspaceVersion', versionSchema);

// 장면은 추가만 가능합니다(수정·삭제 API 없음).
const sceneSchema = new Schema({
  _id: idField,
  projectId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  type: { type: String, enum: ['pause', 'manual', 'safety'], required: true },
  sourceRevision: { type: Number, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
  assetManifest: { type: [Schema.Types.Mixed], default: [] },
  createdBy: { type: String, required: true },
}, { ...schemaOptions(), minimize: false });
const Scene = model('Scene', sceneSchema);

const ShareLink = model('ShareLink', new Schema({
  _id: idField,
  tokenHash: { type: String, required: true, unique: true },
  projectId: { type: String, required: true, index: true },
  role: { type: String, enum: ['viewer'], default: 'viewer' }, // 링크로는 열람 권한만 줍니다.
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  createdBy: { type: String, required: true },
}, schemaOptions(['tokenHash'])));

const AuditLog = model('AuditLog', new Schema({
  projectId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  action: { type: String, required: true },
  detail: { type: Schema.Types.Mixed, default: {} },
}, schemaOptions()));

module.exports = { roles, User, Session, Project, Member, Workspace, WorkspaceVersion, Scene, ShareLink, AuditLog };
