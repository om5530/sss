import { Routes } from '@angular/router';
import { AdminLayout } from './layout/admin-layout';
import { unsavedGuard } from '../../core/guards/unsaved.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      { path: 'categories', loadComponent: () => import('./categories/admin-categories').then((m) => m.AdminCategories), title: 'Categories — SSS Admin' },
      { path: 'notifications', loadComponent: () => import('./notifications/admin-notifications').then((m) => m.AdminNotifications), title: 'Email delivery — SSS Admin' },
      { path: 'settings', loadComponent: () => import('./settings/admin-settings').then((m) => m.AdminSettings), title: 'Store settings — SSS Admin' },
      { path: '', loadComponent: () => import('./dashboard/admin-dashboard').then((m) => m.AdminDashboard), title: 'Dashboard — SSS Admin' },
      { path: 'queue', loadComponent: () => import('./queue/admin-queue').then((m) => m.AdminQueue), title: 'Live queue — SSS Admin' },
      { path: 'prep', loadComponent: () => import('./prep/admin-prep').then((m) => m.AdminPrep), title: 'Prep sheet — SSS Admin' },
      { path: 'qr', loadComponent: () => import('./qr/admin-qr').then((m) => m.AdminQr), title: 'Table QRs — SSS Admin' },
      { path: 'orders', loadComponent: () => import('./orders/admin-orders').then((m) => m.AdminOrders), title: 'Orders — SSS Admin' },
      { path: 'orders/:id', loadComponent: () => import('./order-detail/admin-order-detail').then((m) => m.AdminOrderDetail), title: 'Order — SSS Admin' },
      { path: 'products', loadComponent: () => import('./products/admin-products').then((m) => m.AdminProducts), title: 'Products — SSS Admin' },
      { path: 'products/new', canDeactivate: [unsavedGuard], loadComponent: () => import('./product-form/admin-product-form').then((m) => m.AdminProductForm), title: 'New product — SSS Admin' },
      { path: 'products/:id/edit', canDeactivate: [unsavedGuard], loadComponent: () => import('./product-form/admin-product-form').then((m) => m.AdminProductForm), title: 'Edit product — SSS Admin' },
      { path: 'customers', loadComponent: () => import('./customers/admin-customers').then((m) => m.AdminCustomers), title: 'Customers — SSS Admin' },
      { path: 'customers/:id', loadComponent: () => import('./customer-detail/admin-customer-detail').then((m) => m.AdminCustomerDetail), title: 'Customer — SSS Admin' },
      { path: 'payments', loadComponent: () => import('./payments/admin-payments').then((m) => m.AdminPayments), title: 'Payments — SSS Admin' },
      { path: 'enquiries', loadComponent: () => import('./enquiries/admin-enquiries').then((m) => m.AdminEnquiries), title: 'Enquiries — SSS Admin' },
      { path: 'cake-requests', loadComponent: () => import('./cake-requests/admin-cake-requests').then((m) => m.AdminCakeRequests), title: 'Custom orders — SSS Admin' },
      { path: 'coupons', loadComponent: () => import('./coupons/admin-coupons').then((m) => m.AdminCoupons), title: 'Coupons — SSS Admin' },
      { path: 'reports', loadComponent: () => import('./reports/admin-reports').then((m) => m.AdminReports), title: 'Reports — SSS Admin' },
      { path: 'activity', loadComponent: () => import('./activity/admin-activity').then((m) => m.AdminActivity), title: 'Activity — SSS Admin' },
      // Bakery Manufacturing & Costing Operations
      { path: 'bakery/calculator', loadComponent: () => import('./bakery/calculator/admin-bakery-calculator').then((m) => m.AdminBakeryCalculator), title: '⚡ Calculator — Bakery Operations' },
      { path: 'bakery/recipes', loadComponent: () => import('./bakery/recipes/admin-bakery-recipes').then((m) => m.AdminBakeryRecipes), title: '📜 Recipes — Bakery Operations' },
      { path: 'bakery/materials', loadComponent: () => import('./bakery/materials/admin-bakery-materials').then((m) => m.AdminBakeryMaterials), title: '📦 Materials — Bakery Operations' },
      { path: 'bakery/inventory', loadComponent: () => import('./bakery/inventory/admin-bakery-inventory').then((m) => m.AdminBakeryInventory), title: '📊 Stock & Shortages — Bakery Operations' },
      { path: 'bakery/waste', loadComponent: () => import('./bakery/waste/admin-bakery-waste').then((m) => m.AdminBakeryWaste), title: '🗑️ Waste Tracker — Bakery Operations' },
    ],
  },
];
