import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.Home), title: 'Sweet Savory Savor — Artisan Bakery & Café', data: { description: 'Small-batch brownies, cookies, cakes, wood-fired pizza and barista coffee in Dahisar East, Mumbai. Order for dine-in, takeaway or delivery.' } },
  { path: 'menu', loadComponent: () => import('./pages/menu/menu').then((m) => m.Menu), title: 'Menu — Sweet Savory Savor', data: { description: 'The full bakery & café menu — brownies, cookies, cakes, croissants, wood-fired pizza and coffee, baked fresh daily.' } },
  { path: 'product/:slug', loadComponent: () => import('./pages/product-detail/product-detail').then((m) => m.ProductDetail), title: 'Product — Sweet Savory Savor' },
  { path: 'cart', loadComponent: () => import('./pages/cart/cart').then((m) => m.Cart), title: 'Your Cart — Sweet Savory Savor' },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login), title: 'Sign in — Sweet Savory Savor' },
  // Guest checkout is allowed for dine-in / takeaway; delivery prompts sign-in within the page.
  { path: 'checkout', loadComponent: () => import('./pages/checkout/checkout').then((m) => m.Checkout), title: 'Checkout — Sweet Savory Savor' },
  { path: 'order-success/:id', loadComponent: () => import('./pages/order-success/order-success').then((m) => m.OrderSuccess), title: 'Order Confirmed — Sweet Savory Savor' },
  { path: 'orders', canActivate: [authGuard], loadComponent: () => import('./pages/orders/orders').then((m) => m.Orders), title: 'My Orders — Sweet Savory Savor' },
  { path: 'orders/:id', canActivate: [authGuard], loadComponent: () => import('./pages/order-detail/order-detail').then((m) => m.OrderDetail), title: 'Order — Sweet Savory Savor' },
  { path: 'profile', canActivate: [authGuard], loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile), title: 'Profile — Sweet Savory Savor' },
  // Staff area — lazy-loaded so storefront visitors never download admin code (AS-1.2).
  { path: 'admin', canActivate: [adminGuard], loadChildren: () => import('./pages/admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
  { path: 'custom-cakes', loadComponent: () => import('./pages/custom-cakes/custom-cakes').then((m) => m.CustomCakes), title: 'Custom Cakes — Sweet Savory Savor', data: { description: 'Custom birthday, anniversary and wedding cakes made to order in Mumbai. Send a brief, get a quote the same day.' } },
  { path: 'about', loadComponent: () => import('./pages/about/about').then((m) => m.About), title: 'About — Sweet Savory Savor', data: { description: 'The story behind Sweet Savory Savor — small-batch baking, honest ingredients, and a café that feels like home.' } },
  { path: 'contact', loadComponent: () => import('./pages/contact/contact').then((m) => m.Contact), title: 'Contact — Sweet Savory Savor', data: { description: 'Questions, custom cakes or catering — visit us in Dahisar East, call, or send a message. A human reads every one.' } },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound), title: 'Not found — Sweet Savory Savor' },
];
