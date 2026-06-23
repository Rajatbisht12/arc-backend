const express = require('express');
const router = express.Router();
const {
  addKnowledge,
  getAllKnowledge,
  getKnowledgeById,
  updateKnowledge,
  deleteKnowledge,
  testRetrieval,
  getStats,
  bulkAddKnowledge
} = require('../controllers/knowledgeController');

const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

// Public routes (for testing)
router.post('/test-retrieval', testRetrieval);
router.get('/stats', getStats);

// Protected routes (admin only for now)
router.post('/add', protect, requireAdmin, addKnowledge);
router.post('/bulk-add', protect, requireAdmin, bulkAddKnowledge);
router.get('/', protect, requireAdmin, getAllKnowledge);
router.get('/:id', protect, requireAdmin, getKnowledgeById);
router.put('/:id', protect, requireAdmin, updateKnowledge);
router.delete('/:id', protect, requireAdmin, deleteKnowledge);

module.exports = router;

