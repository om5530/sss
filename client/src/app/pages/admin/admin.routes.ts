import { Routes } from '@angular/router';
import { AdminLayout } from './layout/admin-layout';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      { path: '', loadComponent: () => import('./dashboard/admin-dashboard').then((m) => m.AdminDashboard), title: 'Dashboard — SSS Admin' },
      { path: 'queue', loadComponent: () => import('./queue/admin-queue').then((m) => m.AdminQueue), title: 'Live queue — SSS Admin' },
      { path: 'orders', loadComponent: () => import('./orders/admin-orders').then((m) => m.AdminOrders), title: 'Orders — SSS Admin' },
      { path: 'orders/:id', loadComponent: () => import('./order-detail/admin-order-detail').then((m) => m.AdminOrderDetail), title: 'Order — SSS Admin' },
      { path: 'products', loadComponent: () => import('./products/admin-products').then((m) => m.AdminProducts), title: 'Products — SSS Admin' },
      { path: 'products/new', loadComponent: () => import('./product-form/admin-product-form').then((m) => m.AdminProductForm), title: 'New product — SSS Admin' },
      { path: 'products/:id/edit', loadComponent: () => import('./product-form/admin-product-form').then((m) => m.AdminProductForm), title: 'Edit product — SSS Admin' },
      { path: 'customers', loadComponent: () => import('./customers/admin-customers').then((m) => m.AdminCustomers), title: 'Customers — SSS Admin' },
      { path: 'customers/:id', loadComponent: () => import('./customer-detail/admin-customer-detail').then((m) => m.AdminCustomerDetail), title: 'Customer — SSS Admin' },
      { path: 'payments', loadComponent: () => import('./payments/admin-payments').then((m) => m.AdminPayments), title: 'Payments — SSS Admin' },
      { path: 'enquiries', loadComponent: () => import('./enquiries/admin-enquiries').then((m) => m.AdminEnquiries), title: 'Enquiries — SSS Admin' },
      { path: 'cake-requests', loadComponent: () => import('./cake-requests/admin-cake-requests').then((m) => m.AdminCakeRequests), title: 'Cake requests — SSS Admin' },
      { path: 'coupons', loadComponent: () => import('./coupons/admin-coupons').then((m) => m.AdminCoupons), title: 'Coupons — SSS Admin' },
      { path: 'reports', loadComponent: () => import('./reports/admin-reports').then((m) => m.AdminReports), title: 'Reports — SSS Admin' },
      { path: 'activity', loadComponent: () => import('./activity/admin-activity').then((m) => m.AdminActivity), title: 'Activity — SSS Admin' },
    ],
  },
];
