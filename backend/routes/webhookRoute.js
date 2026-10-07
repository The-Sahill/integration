// routes/webhookRoute.js
const express = require('express');
const router = express.Router();
const { verifyWebhook, handleIncomingMessage } = require('../controllers/webhook');

// مسار توثيق الـ Webhook
router.get('/', verifyWebhook);

// مسار استلام الرسائل
router.post('/', handleIncomingMessage);

module.exports = router;