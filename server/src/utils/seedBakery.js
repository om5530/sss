const mongoose = require('mongoose');
const env = require('../config/env');
const BakeryMaterial = require('../models/BakeryMaterial');
const BakeryRecipe = require('../models/BakeryRecipe');
const costEngine = require('../services/bakeryCost.service');

async function seedBakeryData() {
  try {
    console.log('Seeding Bakery Operations data...');

    const materialsData = [
      // Ingredients
      {
        name: 'All Purpose Flour (Maida)',
        code: 'ING-FLR',
        type: 'ingredient',
        category: 'Flour & Grains',
        baseUom: 'g',
        packQuantity: 1,
        packUom: 'kg',
        purchasePrice: 58,
        currentStock: 10000, // 10 kg
        minimumStock: 2000,
        supplierName: 'Local Grain Mart',
      },
      {
        name: 'Amul Unsalted Butter',
        code: 'ING-BTR',
        type: 'ingredient',
        category: 'Dairy',
        baseUom: 'g',
        packQuantity: 500,
        packUom: 'g',
        purchasePrice: 310,
        currentStock: 3000, // 3 kg
        minimumStock: 1000,
        supplierName: 'Amul Depot',
      },
      {
        name: 'Cocoa Powder (Pure)',
        code: 'ING-COCOA',
        type: 'ingredient',
        category: 'Chocolates & Cocoa',
        baseUom: 'g',
        packQuantity: 225,
        packUom: 'g',
        purchasePrice: 330,
        currentStock: 1500,
        minimumStock: 500,
        supplierName: 'Baker Choice Supplies',
      },
      {
        name: 'Caster Sugar',
        code: 'ING-SGR',
        type: 'ingredient',
        category: 'Sweeteners',
        baseUom: 'g',
        packQuantity: 1,
        packUom: 'kg',
        purchasePrice: 50,
        currentStock: 15000,
        minimumStock: 3000,
        supplierName: 'Local Wholesaler',
      },
      {
        name: 'Fresh Cow Milk',
        code: 'ING-MLK',
        type: 'ingredient',
        category: 'Dairy',
        baseUom: 'ml',
        packQuantity: 1,
        packUom: 'L',
        purchasePrice: 78,
        currentStock: 4000,
        minimumStock: 1000,
        supplierName: 'Dairy Express',
      },
      {
        name: 'Refined Oil',
        code: 'ING-OIL',
        type: 'ingredient',
        category: 'Oils & Fats',
        baseUom: 'ml',
        packQuantity: 1,
        packUom: 'L',
        purchasePrice: 150,
        currentStock: 3000,
        minimumStock: 1000,
        supplierName: 'Local Mart',
      },
      {
        name: 'Baking Powder',
        code: 'ING-BK-POW',
        type: 'ingredient',
        category: 'Leaveners',
        baseUom: 'g',
        packQuantity: 100,
        packUom: 'g',
        purchasePrice: 40,
        currentStock: 500,
        minimumStock: 100,
        supplierName: 'Weikfield Store',
      },
      {
        name: 'Baking Soda',
        code: 'ING-BK-SOD',
        type: 'ingredient',
        category: 'Leaveners',
        baseUom: 'g',
        packQuantity: 100,
        packUom: 'g',
        purchasePrice: 40,
        currentStock: 500,
        minimumStock: 100,
        supplierName: 'Weikfield Store',
      },
      {
        name: 'Cooking Salt',
        code: 'ING-SLT',
        type: 'ingredient',
        category: 'Spices & Salts',
        baseUom: 'g',
        packQuantity: 1,
        packUom: 'kg',
        purchasePrice: 30,
        currentStock: 2000,
        minimumStock: 500,
        supplierName: 'Tata Salt',
      },
      {
        name: 'White Vinegar',
        code: 'ING-VIN',
        type: 'ingredient',
        category: 'Acids & Flavor',
        baseUom: 'ml',
        packQuantity: 500,
        packUom: 'ml',
        purchasePrice: 40,
        currentStock: 1000,
        minimumStock: 200,
        supplierName: 'Local Mart',
      },
      {
        name: 'Pure Vanilla Extract',
        code: 'ING-VAN',
        type: 'ingredient',
        category: 'Extracts',
        baseUom: 'ml',
        packQuantity: 50,
        packUom: 'ml',
        purchasePrice: 120,
        currentStock: 200,
        minimumStock: 50,
        supplierName: 'Sprig Gourmet',
      },
      // Packaging
      {
        name: '8-inch Premium Cake Box',
        code: 'PKG-BOX-8IN',
        type: 'packaging',
        category: 'Cake Packaging',
        baseUom: 'piece',
        packQuantity: 10,
        packUom: 'piece',
        purchasePrice: 250, // ₹25/piece
        currentStock: 45,
        minimumStock: 10,
        supplierName: 'PackPro Pune',
      },
      {
        name: '8-inch Sturdy Cake Board',
        code: 'PKG-BRD-8IN',
        type: 'packaging',
        category: 'Cake Packaging',
        baseUom: 'piece',
        packQuantity: 10,
        packUom: 'piece',
        purchasePrice: 150, // ₹15/piece
        currentStock: 45,
        minimumStock: 10,
        supplierName: 'PackPro Pune',
      },
      // Equipment & Resources
      {
        name: 'Baking Oven (Electric/Gas)',
        code: 'RES-OVEN',
        type: 'resource',
        category: 'Baking Equipment',
        baseUom: 'minute',
        packQuantity: 60,
        packUom: 'minute',
        purchasePrice: 36, // ₹0.60/minute
        currentStock: 99999,
      },
      // Labour
      {
        name: 'Baker & Assistant Labour',
        code: 'LAB-BAKER',
        type: 'labour',
        category: 'Kitchen Staff',
        baseUom: 'piece',
        packQuantity: 1,
        packUom: 'piece',
        purchasePrice: 20, // ₹20/unit
        currentStock: 99999,
      },
    ];

    const createdMaterials = new Map();
    for (const item of materialsData) {
      item.effectiveUnitCost = costEngine.calculateEffectiveUnitCost(
        item.packQuantity,
        item.packUom,
        item.purchasePrice,
        item.baseUom,
      );
      const existing = await BakeryMaterial.findOne({ code: item.code });
      if (existing) {
        Object.assign(existing, item);
        await existing.save();
        createdMaterials.set(item.code, existing);
      } else {
        const m = await BakeryMaterial.create(item);
        createdMaterials.set(item.code, m);
      }
    }
    console.log(`Seeded ${createdMaterials.size} bakery materials.`);

    // Reference Recipe: Classic Butter Cake
    const butterCakeComponents = [
      {
        materialId: createdMaterials.get('ING-FLR')._id,
        name: 'All Purpose Flour (Maida)',
        itemType: 'ingredient',
        quantity: 192,
        uom: 'g',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-BK-POW')._id,
        name: 'Baking Powder',
        itemType: 'ingredient',
        quantity: 4,
        uom: 'g',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-BK-SOD')._id,
        name: 'Baking Soda',
        itemType: 'ingredient',
        quantity: 3,
        uom: 'g',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-SLT')._id,
        name: 'Cooking Salt',
        itemType: 'ingredient',
        quantity: 1,
        uom: 'g',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-BTR')._id,
        name: 'Amul Unsalted Butter',
        itemType: 'ingredient',
        quantity: 70,
        uom: 'g',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-OIL')._id,
        name: 'Refined Oil',
        itemType: 'ingredient',
        quantity: 9,
        uom: 'ml',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-SGR')._id,
        name: 'Caster Sugar',
        itemType: 'ingredient',
        quantity: 150,
        uom: 'g',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-MLK')._id,
        name: 'Fresh Cow Milk',
        itemType: 'ingredient',
        quantity: 250,
        uom: 'ml',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('ING-VIN')._id,
        name: 'White Vinegar',
        itemType: 'ingredient',
        quantity: 5,
        uom: 'ml',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('RES-OVEN')._id,
        name: 'Baking Oven (Electric/Gas)',
        itemType: 'resource',
        quantity: 60,
        uom: 'minute',
        scalingMethod: 'stepped',
        capacityPerCycle: 4, // 4 cakes fit in the oven together
        cycleMinutes: 60,
      },
      {
        materialId: createdMaterials.get('LAB-BAKER')._id,
        name: 'Baker & Assistant Labour',
        itemType: 'labour',
        quantity: 2,
        uom: 'piece',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('PKG-BOX-8IN')._id,
        name: '8-inch Premium Cake Box',
        itemType: 'packaging',
        quantity: 1,
        uom: 'piece',
        scalingMethod: 'linear',
      },
      {
        materialId: createdMaterials.get('PKG-BRD-8IN')._id,
        name: '8-inch Sturdy Cake Board',
        itemType: 'packaging',
        quantity: 1,
        uom: 'piece',
        scalingMethod: 'linear',
      },
    ];

    const butterCakeData = {
      name: 'Classic Butter Cake',
      code: 'RCP-BUTTER-CAKE',
      category: 'Cakes',
      baseBatchUnits: 1,
      yieldQuantity: 1,
      yieldUom: 'cake',
      finishedWeightGrams: 600,
      targetMarkupPercent: 50,
      components: butterCakeComponents,
      instructions: [
        'Sift flour, baking powder, baking soda, and salt together.',
        'Cream room-temperature butter and sugar until light and fluffy.',
        'Alternate adding dry ingredients and milk/vinegar mixture.',
        'Bake at 175°C for 32-35 minutes until golden brown.',
      ],
      notes: 'Standard 600g sponge base for all celebration cakes.',
    };

    const materialMap = new Map();
    for (const [code, m] of createdMaterials.entries()) {
      materialMap.set(String(m._id), m);
    }
    const evaluated = costEngine.evaluateRecipeCost(butterCakeData, materialMap);
    Object.assign(butterCakeData, evaluated);

    const existingRecipe = await BakeryRecipe.findOne({ code: butterCakeData.code });
    if (existingRecipe) {
      Object.assign(existingRecipe, butterCakeData);
      await existingRecipe.save();
    } else {
      await BakeryRecipe.create(butterCakeData);
    }
    console.log('Seeded Classic Butter Cake recipe.');

    console.log('Bakery operations seed completed successfully!');
  } catch (err) {
    console.error('Seed bakery error:', err);
  }
}

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(async () => {
      await seedBakeryData();
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seedBakeryData };
