/**
 * Seeds the product catalogue. Run with: npm run seed
 * Safe to re-run — it replaces all existing products.
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const Product = require('../models/Product');

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Curated, hand-verified product photos — direct, hot-linkable CDN URLs,
// keyed by product slug. Replaces the previous random loremflickr lookup,
// which served off-topic photos (people, novelty cakes) for generic keywords.
// Mirrored in client/src/app/core/utils/food-image.ts — keep the two in sync.
const IMAGES = {
  'classic-fudge-brownie': 'https://images.pexels.com/photos/7157867/pexels-photo-7157867.jpeg?auto=compress&cs=tinysrgb&w=600',
  'walnut-brownie': 'https://images.pexels.com/photos/33813613/pexels-photo-33813613.jpeg?auto=compress&cs=tinysrgb&w=600',
  'salted-caramel-brownie': 'https://images.pexels.com/photos/17701795/pexels-photo-17701795.jpeg?auto=compress&cs=tinysrgb&w=600',
  'chocolate-chip-cookies': 'https://images.pexels.com/photos/8081574/pexels-photo-8081574.jpeg?auto=compress&cs=tinysrgb&w=600',
  'double-chocolate-cookies': 'https://images.pexels.com/photos/33650331/pexels-photo-33650331.jpeg?auto=compress&cs=tinysrgb&w=600',
  'oatmeal-raisin-cookies': 'https://images.pexels.com/photos/8837035/pexels-photo-8837035.jpeg?auto=compress&cs=tinysrgb&w=600',
  'belgian-chocolate-cake': 'https://images.pexels.com/photos/132694/pexels-photo-132694.jpeg?auto=compress&cs=tinysrgb&w=600',
  'red-velvet-cake': 'https://images.pexels.com/photos/6133313/pexels-photo-6133313.jpeg?auto=compress&cs=tinysrgb&w=600',
  'new-york-cheesecake': 'https://images.pexels.com/photos/10964759/pexels-photo-10964759.jpeg?auto=compress&cs=tinysrgb&w=600',
  'classic-tiramisu': 'https://images.pexels.com/photos/20586637/pexels-photo-20586637.jpeg?auto=compress&cs=tinysrgb&w=600',
  'biscoff-tiramisu': 'https://images.pexels.com/photos/35135510/pexels-photo-35135510.jpeg?auto=compress&cs=tinysrgb&w=600',
  'vanilla-buttercream-cupcake': 'https://images.unsplash.com/photo-1531112868439-b6b658cfe48a?w=600&q=80&auto=format&fit=crop',
  'chocolate-cupcake': 'https://images.pexels.com/photos/1775285/pexels-photo-1775285.jpeg?auto=compress&cs=tinysrgb&w=600',
  'red-velvet-cupcake': 'https://images.pexels.com/photos/12064970/pexels-photo-12064970.jpeg?auto=compress&cs=tinysrgb&w=600',
  'butter-croissant': 'https://images.pexels.com/photos/4828275/pexels-photo-4828275.jpeg?auto=compress&cs=tinysrgb&w=600',
  'chocolate-croissant': 'https://images.pexels.com/photos/4828307/pexels-photo-4828307.jpeg?auto=compress&cs=tinysrgb&w=600',
  'almond-danish': 'https://images.pexels.com/photos/4828336/pexels-photo-4828336.jpeg?auto=compress&cs=tinysrgb&w=600',
  'margherita-pizza': 'https://images.pexels.com/photos/14590497/pexels-photo-14590497.jpeg?auto=compress&cs=tinysrgb&w=600',
  'farmhouse-pizza': 'https://images.pexels.com/photos/5640015/pexels-photo-5640015.jpeg?auto=compress&cs=tinysrgb&w=600',
  'peri-peri-paneer-pizza': 'https://images.pexels.com/photos/35123976/pexels-photo-35123976.jpeg?auto=compress&cs=tinysrgb&w=600',
  'chicken-supreme-pizza': 'https://images.pexels.com/photos/803290/pexels-photo-803290.jpeg?auto=compress&cs=tinysrgb&w=600',
  'classic-veg-burger': 'https://images.pexels.com/photos/28636771/pexels-photo-28636771.jpeg?auto=compress&cs=tinysrgb&w=600',
  'cheese-burger': 'https://images.pexels.com/photos/19259149/pexels-photo-19259149.jpeg?auto=compress&cs=tinysrgb&w=600',
  'crispy-chicken-burger': 'https://images.pexels.com/photos/11354334/pexels-photo-11354334.jpeg?auto=compress&cs=tinysrgb&w=600',
  'grilled-veg-sandwich': 'https://images.pexels.com/photos/7729372/pexels-photo-7729372.jpeg?auto=compress&cs=tinysrgb&w=600',
  'paneer-tikka-sandwich': 'https://images.pexels.com/photos/36268517/pexels-photo-36268517.jpeg?auto=compress&cs=tinysrgb&w=600',
  'chicken-club-sandwich': 'https://images.pexels.com/photos/15662232/pexels-photo-15662232.jpeg?auto=compress&cs=tinysrgb&w=600',
  'peri-peri-fries': 'https://images.pexels.com/photos/4109234/pexels-photo-4109234.jpeg?auto=compress&cs=tinysrgb&w=600',
  'cheese-garlic-bread': 'https://images.pexels.com/photos/7159284/pexels-photo-7159284.jpeg?auto=compress&cs=tinysrgb&w=600',
  'veg-nuggets': 'https://images.pexels.com/photos/1059943/pexels-photo-1059943.jpeg?auto=compress&cs=tinysrgb&w=600',
};

// Per-category fallback — only used if a newly added item has no curated image.
const CATEGORY_IMAGE = {
  Brownies: IMAGES['classic-fudge-brownie'],
  Cookies: IMAGES['chocolate-chip-cookies'],
  Cakes: IMAGES['belgian-chocolate-cake'],
  Tiramisu: IMAGES['classic-tiramisu'],
  Cupcakes: IMAGES['chocolate-cupcake'],
  Pastries: IMAGES['butter-croissant'],
  Pizza: IMAGES['margherita-pizza'],
  Burgers: IMAGES['cheese-burger'],
  Sandwiches: IMAGES['grilled-veg-sandwich'],
  Snacks: IMAGES['peri-peri-fries'],
};

const img = (slug, category) =>
  IMAGES[slug] || CATEGORY_IMAGE[category] || IMAGES['classic-fudge-brownie'];

// [name, description, price, dietary?, featured?]
const catalog = [
  {
    group: 'bakery',
    category: 'Brownies',
    items: [
      ['Classic Fudge Brownie', 'Rich, gooey chocolate brownie with a fudgy centre.', 120, 'veg', true],
      ['Walnut Brownie', 'Fudgy brownie loaded with toasted walnuts.', 140, 'veg'],
      ['Salted Caramel Brownie', 'Brownie swirled with house-made salted caramel.', 160, 'veg', true],
    ],
  },
  {
    group: 'bakery',
    category: 'Cookies',
    items: [
      ['Chocolate Chip Cookies', 'Crisp edges, soft centre, loaded with chocolate chips.', 150, 'veg', true],
      ['Double Chocolate Cookies', 'Cocoa cookies with dark chocolate chunks.', 160, 'veg'],
      ['Oatmeal Raisin Cookies', 'Chewy oat cookies with plump raisins.', 140, 'veg'],
    ],
  },
  {
    group: 'bakery',
    category: 'Cakes',
    items: [
      ['Belgian Chocolate Cake', 'Decadent slice of rich Belgian chocolate cake.', 180, 'egg', true],
      ['Red Velvet Cake', 'Classic red velvet slice with cream cheese frosting.', 190, 'egg', true],
      ['New York Cheesecake', 'Creamy baked cheesecake on a biscuit base.', 220, 'egg'],
    ],
  },
  {
    group: 'bakery',
    category: 'Tiramisu',
    items: [
      ['Classic Tiramisu', 'Espresso-soaked ladyfingers with mascarpone cream.', 240, 'egg', true],
      ['Biscoff Tiramisu', 'Tiramisu layered with caramelised Biscoff.', 260, 'egg'],
    ],
  },
  {
    group: 'bakery',
    category: 'Cupcakes',
    items: [
      ['Vanilla Buttercream Cupcake', 'Soft vanilla sponge with silky buttercream.', 90, 'egg'],
      ['Chocolate Cupcake', 'Moist chocolate cupcake with ganache swirl.', 100, 'egg', true],
      ['Red Velvet Cupcake', 'Red velvet cupcake topped with cream cheese frosting.', 110, 'egg'],
    ],
  },
  {
    group: 'bakery',
    category: 'Pastries',
    items: [
      ['Butter Croissant', 'Flaky, all-butter French croissant.', 110, 'veg'],
      ['Chocolate Croissant', 'Buttery croissant filled with dark chocolate.', 130, 'veg', true],
      ['Almond Danish', 'Crisp danish with almond cream and flaked almonds.', 140, 'veg'],
    ],
  },
  {
    group: 'savoury',
    category: 'Pizza',
    items: [
      ['Margherita Pizza', 'Tomato, mozzarella and fresh basil.', 280, 'veg'],
      ['Farmhouse Pizza', 'Loaded with onion, capsicum, mushroom and corn.', 350, 'veg', true],
      ['Peri Peri Paneer Pizza', 'Spicy peri peri paneer with onion and capsicum.', 360, 'veg'],
      ['Chicken Supreme Pizza', 'Grilled chicken, pepperoni and bell peppers.', 420, 'non-veg'],
    ],
  },
  {
    group: 'savoury',
    category: 'Burgers',
    items: [
      ['Classic Veg Burger', 'Crunchy veg patty with lettuce and house sauce.', 150, 'veg'],
      ['Cheese Burger', 'Double cheese, caramelised onion and pickles.', 200, 'veg', true],
      ['Crispy Chicken Burger', 'Buttermilk-fried chicken with slaw and mayo.', 240, 'non-veg'],
    ],
  },
  {
    group: 'savoury',
    category: 'Sandwiches',
    items: [
      ['Grilled Veg Sandwich', 'Grilled vegetables and cheese on sourdough.', 160, 'veg'],
      ['Paneer Tikka Sandwich', 'Spiced paneer tikka with mint chutney.', 190, 'veg'],
      ['Chicken Club Sandwich', 'Triple-decker with chicken, egg and lettuce.', 220, 'non-veg'],
    ],
  },
  {
    group: 'savoury',
    category: 'Snacks',
    items: [
      ['Peri Peri Fries', 'Crispy fries tossed in peri peri seasoning.', 120, 'veg'],
      ['Cheese Garlic Bread', 'Toasted garlic bread with molten cheese.', 150, 'veg', true],
      ['Veg Nuggets', 'Golden, crunchy vegetable nuggets with dip.', 140, 'veg'],
    ],
  },
];

function buildDocs() {
  const docs = [];
  for (const block of catalog) {
    for (const [name, description, price, dietary = 'veg', featured = false] of block.items) {
      const slug = slugify(name);
      docs.push({
        name,
        slug,
        group: block.group,
        category: block.category,
        description,
        price,
        dietary,
        featured,
        available: true,
        image: img(slug, block.category),
        tags: [block.category.toLowerCase(), block.group],
      });
    }
  }
  return docs;
}

async function run() {
  await mongoose.connect(env.mongoUri);
  const docs = buildDocs();
  await Product.deleteMany({});
  await Product.insertMany(docs);
  console.log(`✅  Seeded ${docs.length} products across ${catalog.length} categories.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
