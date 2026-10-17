// routes/chatDashboardRoutes.js
const express = require('express');
const router = express.Router();
const { 
  getAllConversations, 
  toggleAiStatus, 
  sendAgentMessage 
} = require('../controllers/chatController');

router.get('/conversations', getAllConversations);
router.patch('/conversations/:id/toggle-ai', toggleAiStatus);
router.post('/conversations/:id/send-message', sendAgentMessage);

module.exports = router;