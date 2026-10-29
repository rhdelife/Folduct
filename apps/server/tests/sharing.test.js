const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const createApp = require('../src/app');

let mongo;
let app;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

let seq = 0;
async function signUp(name) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: `${name}${++seq}@test.dev`, name, password: 'password123' });
  expect(res.status).toBe(201);
  return { token: res.body.data.token, user: res.body.data.user };
}
const as = (who) => ({ Authorization: `Bearer ${who.token}` });

async function sharedProject() {
  const owner = await signUp('owner');
  const viewer = await signUp('viewer');
  const created = await request(app).post('/api/projects').set(as(owner))
    .send({ name: '졸업 작품', coverColor: '#f5c542', workspace: { cards: [{ id: 'c1', note: '원본' }], nextAction: '' } });
  expect(created.status).toBe(201);
  const id = created.body.data.project.id;
  const link = await request(app).post(`/api/projects/${id}/share-links`).set(as(owner)).send({});
  const accepted = await request(app).post(`/api/share-links/${link.body.data.token}/accept`).set(as(viewer));
  expect(accepted.body.data.role).toBe('viewer');
  return { owner, viewer, id, link: link.body.data };
}

test('auth: 비밀번호 해시는 응답에 없고, 틀린 비밀번호는 401', async () => {
  const { user } = await signUp('a');
  expect(user.passwordHash).toBeUndefined();
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
  expect(res.status).toBe(401);
  expect((await request(app).get('/api/projects')).status).toBe(401);
});

test('viewer는 읽을 수 있지만 고칠 수 없다', async () => {
  const { viewer, id } = await sharedProject();

  const ws = await request(app).get(`/api/projects/${id}/workspace`).set(as(viewer));
  expect(ws.status).toBe(200);
  expect(ws.body.data.content.cards[0].note).toBe('원본');

  const writes = [
    request(app).put(`/api/projects/${id}/workspace`).set(as(viewer)).send({ expectedRevision: 1, workspace: { cards: [] } }),
    request(app).post(`/api/projects/${id}/scenes`).set(as(viewer)).send({ title: 'x', type: 'manual', snapshot: {} }),
    request(app).patch(`/api/projects/${id}`).set(as(viewer)).send({ name: '훼손' }),
    request(app).delete(`/api/projects/${id}`).set(as(viewer)),
    request(app).post(`/api/projects/${id}/share-links`).set(as(viewer)).send({}),
  ];
  for (const res of await Promise.all(writes)) expect(res.status).toBe(403);

  const after = await request(app).get(`/api/projects/${id}/workspace`).set(as(viewer));
  expect(after.body.data.revision).toBe(1);
  expect(after.body.data.content.cards[0].note).toBe('원본');
});

test('멤버가 아니면 프로젝트 존재 자체를 알 수 없다(404)', async () => {
  const { id } = await sharedProject();
  const stranger = await signUp('stranger');
  expect((await request(app).get(`/api/projects/${id}`).set(as(stranger))).status).toBe(404);
});

test('editor 동시 저장: 오래된 revision은 409이고 덮어쓰지 않는다, 버전이 남는다', async () => {
  const { owner, id } = await sharedProject();
  const editor = await signUp('editor');
  await request(app).post(`/api/projects/${id}/members`).set(as(owner)).send({ email: editor.user.email, role: 'editor' });

  const first = await request(app).put(`/api/projects/${id}/workspace`).set(as(editor))
    .send({ expectedRevision: 1, workspace: { cards: [{ id: 'c1', note: '편집자' }], revision: 999 } });
  expect(first.status).toBe(200);
  expect(first.body.data.revision).toBe(2); // 클라이언트가 보낸 revision 999는 무시

  const stale = await request(app).put(`/api/projects/${id}/workspace`).set(as(owner))
    .send({ expectedRevision: 1, workspace: { cards: [] } });
  expect(stale.status).toBe(409);
  expect(stale.body.error.currentRevision).toBe(2);

  const versions = await request(app).get(`/api/projects/${id}/workspace/versions`).set(as(owner));
  expect(versions.body.data.map((v) => v.revision)).toEqual([2, 1]);
  const v1 = await request(app).get(`/api/projects/${id}/workspace/versions/1`).set(as(owner));
  expect(v1.body.data.content.cards[0].note).toBe('원본');
});

test('장면은 추가만 되고 수정·삭제 경로가 없다', async () => {
  const { owner, id } = await sharedProject();
  const scene = await request(app).post(`/api/projects/${id}/scenes`).set(as(owner))
    .send({ title: '중간 점검', type: 'manual', snapshot: { cards: [] } });
  expect(scene.status).toBe(201);
  expect(scene.body.data.sourceRevision).toBe(1);
  const sid = scene.body.data.id;
  expect((await request(app).delete(`/api/projects/${id}/scenes/${sid}`).set(as(owner))).status).toBe(404);
  expect((await request(app).put(`/api/projects/${id}/scenes/${sid}`).set(as(owner)).send({})).status).toBe(404);
});

test('취소한 링크는 더 이상 쓸 수 없고, 소유자를 viewer로 낮추지 않는다', async () => {
  const { owner, id, link } = await sharedProject();
  const again = await request(app).post(`/api/share-links/${link.token}/accept`).set(as(owner));
  expect(again.body.data.role).toBe('owner');

  await request(app).delete(`/api/projects/${id}/share-links/${link.id}`).set(as(owner));
  const late = await signUp('late');
  expect((await request(app).post(`/api/share-links/${link.token}/accept`).set(as(late))).status).toBe(404);
});

test('삭제는 soft delete이고 감사 기록이 남는다', async () => {
  const { owner, viewer, id } = await sharedProject();
  const audit = await request(app).get(`/api/projects/${id}/audit`).set(as(owner));
  expect(audit.body.data.map((a) => a.action)).toEqual(
    expect.arrayContaining(['project.create', 'shareLink.create', 'shareLink.accept']),
  );

  expect((await request(app).delete(`/api/projects/${id}`).set(as(owner))).status).toBe(204);
  expect((await request(app).get(`/api/projects/${id}`).set(as(viewer))).status).toBe(404);
  expect(await mongoose.model('Workspace').exists({ _id: id })).toBeTruthy();
});

test('viewer는 스스로 나갈 수 있지만 남을 내보낼 수 없다', async () => {
  const { owner, viewer, id } = await sharedProject();
  expect((await request(app).delete(`/api/projects/${id}/members/${owner.user.id}`).set(as(viewer))).status).toBe(403);
  expect((await request(app).delete(`/api/projects/${id}/members/${viewer.user.id}`).set(as(viewer))).status).toBe(204);
});
