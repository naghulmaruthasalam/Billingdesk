export const PERMISSIONS = [
  'billing.create',
  'billing.discount_override',
  'billing.stock_override',
  'billing.reprint',
  'sales.view',
  'sales.cancel',
  'sales.refund',
  'sales.collect_due',
  'products.view',
  'products.edit',
  'products.import',
  'catalogue.approve',
  'inventory.view',
  'inventory.adjust',
  'purchases.manage',
  'customers.manage',
  'reports.view',
  'expenses.manage',
  'users.manage',
  'settings.manage',
  'backup.manage',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'billing.create': 'Create bills',
  'billing.discount_override': 'Override discounts',
  'billing.stock_override': 'Sell beyond available stock',
  'billing.reprint': 'Print and reprint invoices',
  'sales.view': 'View sales history',
  'sales.cancel': 'Cancel / void bills',
  'sales.refund': 'Process returns and refunds',
  'sales.collect_due': 'Collect pending bill payments',
  'products.view': 'View products',
  'products.edit': 'Edit products and prices',
  'products.import': 'Import / export catalogue',
  'catalogue.approve': 'Approve catalogue for billing',
  'inventory.view': 'View inventory',
  'inventory.adjust': 'Adjust stock',
  'purchases.manage': 'Record stock purchases and suppliers',
  'customers.manage': 'Manage customers',
  'reports.view': 'View reports and dashboard totals',
  'expenses.manage': 'Manage expenses',
  'users.manage': 'Manage users and role permissions',
  'settings.manage': 'Change settings',
  'backup.manage': 'Backup, restore and integrity checks',
  'audit.view': 'View audit log',
};

export type RoleName = 'owner' | 'cashier' | 'inventory_manager';

export const ROLE_LABELS: Record<RoleName, string> = {
  owner: 'Owner / Admin',
  cashier: 'Cashier',
  inventory_manager: 'Inventory Manager',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  owner: PERMISSIONS,
  cashier: [
    'billing.create',
    'billing.reprint',
    'sales.view',
    'sales.collect_due',
    'products.view',
    'inventory.view',
    'customers.manage',
  ],
  inventory_manager: [
    'products.view',
    'products.edit',
    'products.import',
    'inventory.view',
    'inventory.adjust',
    'purchases.manage',
    'customers.manage',
    'reports.view',
    'sales.view',
  ],
};
