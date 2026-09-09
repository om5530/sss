import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.Home), title: 'The Golden Batch — Artisan Bakery & Café', data: { description: 'Small-batch brownies, cookies, cakes, wood-fired pizza and barista coffee in Dahisar East, Mumbai. Order for dine-in, takeaway or delivery.' } },
  { path: 'menu', loadComponent: () => import('./pages/menu/menu').then((m) => m.Menu), title: 'Menu — The Golden Batch', data: { description: 'The full bakery & café menu — brownies, cookies, cakes, croissants, wood-fired pizza and coffee, baked fresh daily.' } },
  { path: 'product/:slug', loadComponent: () => import('./pages/product-detail/product-detail').then((m) => m.ProductDetail), title: 'Product — The Golden Batch' },
  { path: 'cart', loadComponent: () => import('./pages/cart/cart').then((m) => m.Cart), title: 'Your Cart — The Golden Batch' },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login), title: 'Sign in — The Golden Batch' },
  // Guest checkout is allowed for dine-in / takeaway; delivery prompts sign-in within the page.
  { path: 'checkout', loadComponent: () => import('./pages/checkout/checkout').then((m) => m.Checkout), title: 'Checkout — The Golden Batch' },
  { path: 'order-success/:id', loadComponent: () => import('./pages/order-success/order-success').then((m) => m.OrderSuccess), title: 'Order Confirmed — The Golden Batch' },
  { path: 'orders', canActivate: [authGuard], loadComponent: () => import('./pages/orders/orders').then((m) => m.Orders), title: 'My Orders — The Golden Batch' },
  { path: 'orders/:id', canActivate: [authGuard], loadComponent: () => import('./pages/order-detail/order-detail').then((m) => m.OrderDetail), title: 'Order — The Golden Batch' },
  { path: 'profile', canActivate: [authGuard], loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile), title: 'Profile — The Golden Batch' },
  // Staff area — lazy-loaded so storefront visitors never download admin code (AS-1.2).
  { path: 'admin', canActivate: [adminGuard], loadChildren: () => import('./pages/admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
  { path: 'custom-cakes', redirectTo: 'custom-orders', pathMatch: 'full' },
  { path: 'custom-orders', loadComponent: () => import('./pages/custom-cakes/custom-cakes').then((m) => m.CustomCakes), title: 'Custom Orders — The Golden Batch', data: { description: 'Request custom brownies, cakes, hampers, snacks and bulk orders in Pune. Tell us your requirements for a quote.' } },
  { path: 'about', loadComponent: () => import('./pages/about/about').then((m) => m.About), title: 'About — The Golden Batch', data: { description: 'The story behind The Golden Batch — small-batch baking, honest ingredients, and a café that feels like home.' } },
  { path: 'contact', loadComponent: () => import('./pages/contact/contact').then((m) => m.Contact), title: 'Contact — The Golden Batch', data: { description: 'Questions, custom cakes or catering — visit us in Dahisar East, call, or send a message. A human reads every one.' } },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound), title: 'Not found — The Golden Batch' },
];
