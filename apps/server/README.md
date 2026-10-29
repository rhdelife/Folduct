# folduct-server

Folduct 프로젝트를 다른 사람과 권한별로 공유하는 API 서버 (Express 5 + MongoDB).

```bash
cp .env.example .env   # MONGODB_URI 수정
npm install
npm run dev            # http://localhost:4000
npm test               # 메모리 Mongo로 권한·충돌 테스트
```

## 권한

| 역할 | 읽기 | 작업면 저장·장면 추가 | 이름 변경·삭제·멤버·링크 관리 |
|---|---|---|---|
| owner | ✅ | ✅ | ✅ |
| editor | ✅ | ✅ | ❌ |
| viewer | ✅ | ❌ | ❌ |

공유 링크로 들어온 사람은 항상 viewer입니다. editor는 소유자가 이메일로 직접 추가합니다.

## 훼손 방지

- 권한 검사는 `src/middleware/requireRole.middleware.js` 한 곳에서만 합니다. 멤버가 아니면 404.
- 작업면 저장은 `expectedRevision`이 현재와 같을 때만 됩니다. 다르면 409, 아무것도 바뀌지 않습니다.
- 저장할 때마다 `WorkspaceVersion`이 남습니다. 수정·삭제 API가 없습니다.
- 장면(Scene)은 추가만 됩니다.
- 프로젝트 삭제는 `deletedAt`만 표시합니다. 데이터는 남습니다.
- 모든 쓰기는 `AuditLog`에 기록됩니다.
- 원본 파일은 서버에 올리지 않습니다. 작업면·장면·파일 목록(메타데이터)만 공유합니다.

## API

인증: `Authorization: Bearer <token>`

```
POST   /api/auth/register | /login | /logout     GET /api/auth/me
GET    /api/projects                              내가 속한 프로젝트 + 내 역할
POST   /api/projects                              로컬 프로젝트 올리기 {name, coverColor, workspace}
GET    /api/projects/:id                          viewer
PATCH  /api/projects/:id                          owner
DELETE /api/projects/:id                          owner (soft delete)
GET    /api/projects/:id/workspace                viewer
PUT    /api/projects/:id/workspace                editor {expectedRevision, workspace}
GET    /api/projects/:id/workspace/versions[/:revision]   viewer
GET    /api/projects/:id/scenes                   viewer
POST   /api/projects/:id/scenes                   editor {title, type, snapshot, assetManifest}
GET    /api/projects/:id/members                  viewer
POST   /api/projects/:id/members                  owner {email, role}
PATCH  /api/projects/:id/members/:userId          owner {role}
DELETE /api/projects/:id/members/:userId          owner, 또는 본인(나가기)
GET|POST /api/projects/:id/share-links            owner {expiresInDays 1~30}
DELETE /api/projects/:id/share-links/:linkId      owner
POST   /api/share-links/:token/accept             로그인한 사용자 → viewer
GET    /api/projects/:id/audit                    owner
```
