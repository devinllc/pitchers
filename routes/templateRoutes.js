const express = require('express');
const router = express.Router();
const ApiKeyAuthMiddleware = require('../middleware/apiKeyAuth');
const templateController = require('../controllers/templateController');

const apiKeyAuth = new ApiKeyAuthMiddleware();

router.use(apiKeyAuth.authenticate());

router.get('/', templateController.listTemplates);
router.get('/channel/:channel', templateController.listTemplates);
router.get('/:templateId', templateController.getTemplate);
router.post('/', templateController.createTemplate);
router.put('/:templateId', templateController.updateTemplate);
router.delete('/:templateId', templateController.deleteTemplate);

module.exports = router;
