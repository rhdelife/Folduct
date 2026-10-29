const express = require('express');
const controller = require('../controllers/projects.controller');
const requireAuth = require('../middleware/auth.middleware');
const role = require('../middleware/requireRole.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.list);
router.post('/', controller.create);

router.get('/:id', role('viewer'), controller.get);
router.patch('/:id', role('owner'), controller.update);
router.delete('/:id', role('owner'), controller.remove);

router.get('/:id/workspace', role('viewer'), controller.getWorkspace);
router.put('/:id/workspace', role('editor'), controller.saveWorkspace);
router.get('/:id/workspace/versions', role('viewer'), controller.listVersions);
router.get('/:id/workspace/versions/:revision', role('viewer'), controller.getVersion);

// 장면은 수정·삭제 라우트를 일부러 만들지 않습니다.
router.get('/:id/scenes', role('viewer'), controller.listScenes);
router.post('/:id/scenes', role('editor'), controller.createScene);

router.get('/:id/members', role('viewer'), controller.listMembers);
router.post('/:id/members', role('owner'), controller.addMember);
router.patch('/:id/members/:userId', role('owner'), controller.updateMember);
router.delete('/:id/members/:userId', role('viewer'), controller.removeMember);

router.get('/:id/share-links', role('owner'), controller.listShareLinks);
router.post('/:id/share-links', role('owner'), controller.createShareLink);
router.delete('/:id/share-links/:linkId', role('owner'), controller.revokeShareLink);

router.get('/:id/audit', role('owner'), controller.listAudit);

module.exports = router;
