import { Product } from '../models/product.model';

/**
 * Curated, hand-verified product photos — direct, hot-linkable CDN URLs,
 * keyed by product slug. Used as a fallback when a product has no real image
 * (legacy placeholder data) or when its stored image fails to load.
 * Mirrors server/src/utils/seed.js — keep the two in sync.
 */
const PRODUCT_IMAGES: Record<string, string> = {
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

/** Per-category fallback — used when a product's slug isn't in the map. */
const CATEGORY_IMAGES: Record<string, string> = {
  Brownies: PRODUCT_IMAGES['classic-fudge-brownie'],
  Cookies: PRODUCT_IMAGES['chocolate-chip-cookies'],
  Cakes: PRODUCT_IMAGES['belgian-chocolate-cake'],
  Tiramisu: PRODUCT_IMAGES['classic-tiramisu'],
  Cupcakes: PRODUCT_IMAGES['chocolate-cupcake'],
  Pastries: PRODUCT_IMAGES['butter-croissant'],
  Pizza: PRODUCT_IMAGES['margherita-pizza'],
  Burgers: PRODUCT_IMAGES['cheese-burger'],
  Sandwiches: PRODUCT_IMAGES['grilled-veg-sandwich'],
  Snacks: PRODUCT_IMAGES['peri-peri-fries'],
};

/** Curated hero photo for a category — used by showcase/gallery sections. */
export function categoryImage(category: string): string {
  return CATEGORY_IMAGES[category] || PRODUCT_IMAGES['classic-fudge-brownie'];
}

/** Resolves a relevant, on-topic photo for a product, by slug then category. */
export function foodImage(product: Pick<Product, 'slug' | 'category'>): string {
  return (
    PRODUCT_IMAGES[product.slug] ||
    CATEGORY_IMAGES[product.category] ||
    PRODUCT_IMAGES['classic-fudge-brownie']
  );
}

/**
 * True for images we should replace with {@link foodImage}: empty/missing
 * values, the old placehold.co placeholders, and legacy loremflickr URLs
 * (which served random, off-topic photos). Treating loremflickr as a
 * placeholder lets the UI self-heal even before the catalogue is re-seeded.
 */
export function isPlaceholderImage(image?: string | null): boolean {
  return !image || image.includes('placehold.co') || image.includes('loremflickr');
}
