const express = require('express');
const ctrl = require('../controllers/bakery.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Role gate for internal admin operations
router.use(requireAuth, requireRole('admin'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Materials
router.get('/materials', ctrl.getMaterials);
router.post('/materials', ctrl.createMaterial);
router.patch('/materials/:id', ctrl.updateMaterial);
router.delete('/materials/:id', ctrl.deleteMaterial);

// Recipes
router.get('/recipes', ctrl.getRecipes);
router.get('/recipes/:id', ctrl.getRecipeById);
router.post('/recipes', ctrl.createRecipe);
router.patch('/recipes/:id', ctrl.updateRecipe);
router.delete('/recipes/:id', ctrl.deleteRecipe);

// Calculator & Simulation
router.post('/simulate/recipe', ctrl.simulateRecipe);
router.post('/simulate/multi', ctrl.simulateMultiProduct);
router.get('/costing-sheets', ctrl.getCostingSheets);
router.post('/costing-sheets', ctrl.saveCostingSheet);

// Inventory & Stock
router.get('/inventory', ctrl.getInventoryStatus);
router.patch('/inventory/:id/stock', ctrl.updateStock);

// Waste
router.get('/waste', ctrl.getWasteLogs);
router.post('/waste', ctrl.logWaste);

module.exports = router;
