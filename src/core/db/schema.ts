/** Ordered SQL migrations. Never edit a released migration - append a new one. */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const m1 = `
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name_en TEXT NOT NULL UNIQUE,
  name_ta TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  discount_rule TEXT NOT NULL DEFAULT 'inherit' CHECK (discount_rule IN ('inherit','eligible','never')),
  discount_bp INTEGER CHECK (discount_bp IS NULL OR (discount_bp BETWEEN 0 AND 10000)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name_en TEXT NOT NULL,
  name_ta TEXT NOT NULL DEFAULT '',
  category_id INTEGER NOT NULL REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'Box',
  price_paise INTEGER CHECK (price_paise IS NULL OR price_paise >= 0),
  cost_paise INTEGER CHECK (cost_paise IS NULL OR cost_paise >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  discount_rule TEXT NOT NULL DEFAULT 'inherit' CHECK (discount_rule IN ('inherit','eligible','never')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes TEXT,
  printed_no INTEGER,
  printed_price_paise INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok','needs_review')),
  review_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_name_en ON products(name_en COLLATE NOCASE);
CREATE INDEX idx_products_active ON products(active);
CREATE INDEX idx_products_review ON products(review_status);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_name ON customers(name COLLATE NOCASE);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  purchase_no TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_invoice_no TEXT,
  purchase_date TEXT NOT NULL,
  total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_purchases_date ON purchases(purchase_date);

CREATE TABLE purchase_lines (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_paise INTEGER CHECK (unit_cost_paise IS NULL OR unit_cost_paise >= 0)
);
CREATE INDEX idx_purchase_lines_purchase ON purchase_lines(purchase_id);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL UNIQUE,
  client_request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL,
  discount_rounding_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  tax_enabled INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp INTEGER NOT NULL DEFAULT 0,
  tax_inclusive INTEGER NOT NULL DEFAULT 0,
  rounding_scope TEXT NOT NULL,
  rounding_unit TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','partial','unpaid')),
  notes TEXT,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancel_reason TEXT,
  approved_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_invoices_date ON invoices(business_date);
CREATE INDEX idx_invoices_created ON invoices(created_at);
CREATE INDEX idx_invoices_cashier ON invoices(cashier_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  line_no INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ta TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  rate_paise INTEGER NOT NULL CHECK (rate_paise >= 0),
  gross_paise INTEGER NOT NULL,
  discount_bp INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  net_paise INTEGER NOT NULL,
  discount_source TEXT NOT NULL DEFAULT 'none' CHECK (discount_source IN ('none','policy','override')),
  override_reason TEXT,
  stock_override INTEGER NOT NULL DEFAULT 0,
  cost_paise INTEGER,
  UNIQUE (invoice_id, line_no)
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX idx_invoice_lines_product ON invoice_lines(product_id);

CREATE TABLE returns (
  id INTEGER PRIMARY KEY,
  return_no TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  refund_mode TEXT NOT NULL CHECK (refund_mode IN ('cash','upi','card','credit_note')),
  refund_paise INTEGER NOT NULL CHECK (refund_paise >= 0),
  client_request_id TEXT UNIQUE
);
CREATE INDEX idx_returns_invoice ON returns(invoice_id);
CREATE INDEX idx_returns_date ON returns(business_date);

CREATE TABLE return_lines (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id),
  invoice_line_id INTEGER NOT NULL REFERENCES invoice_lines(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  refund_paise INTEGER NOT NULL CHECK (refund_paise >= 0),
  restocked INTEGER NOT NULL DEFAULT 1 CHECK (restocked IN (0,1))
);
CREATE INDEX idx_return_lines_return ON return_lines(return_id);
CREATE INDEX idx_return_lines_invline ON return_lines(invoice_line_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL CHECK (kind IN ('sale','due','refund')),
  mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','credit_note')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  tendered_paise INTEGER,
  reference TEXT,
  return_id INTEGER REFERENCES returns(id),
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_date ON payments(business_date);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'opening','purchase','sale','sale_cancel','return_restock','return_damaged',
    'adjustment','damage','expiry','count_correction')),
  qty_delta INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_movements_product ON inventory_movements(product_id, created_at);
CREATE INDEX idx_movements_date ON inventory_movements(business_date);
CREATE INDEX idx_movements_ref ON inventory_movements(ref_type, ref_id);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  payment_mode TEXT NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash','upi','card')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  void_reason TEXT
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  approver_username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT
);
CREATE INDEX idx_audit_ts ON audit_logs(ts);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- Completed invoices are immutable financial records. They can be cancelled (status change) but never
-- edited or deleted; corrections go through returns / cancellations / adjustments.
CREATE TRIGGER trg_invoices_no_delete BEFORE DELETE ON invoices
BEGIN SELECT RAISE(ABORT, 'Invoices cannot be deleted'); END;

CREATE TRIGGER trg_invoices_immutable BEFORE UPDATE ON invoices
WHEN NEW.invoice_no <> OLD.invoice_no OR NEW.seq <> OLD.seq OR NEW.business_date <> OLD.business_date
  OR NEW.created_at <> OLD.created_at OR NEW.cashier_id <> OLD.cashier_id
  OR NEW.subtotal_paise <> OLD.subtotal_paise OR NEW.discount_paise <> OLD.discount_paise
  OR NEW.tax_paise <> OLD.tax_paise OR NEW.total_paise <> OLD.total_paise
  OR NEW.discount_rounding_paise <> OLD.discount_rounding_paise
  OR (OLD.status = 'cancelled' AND NEW.status <> 'cancelled')
BEGIN SELECT RAISE(ABORT, 'Invoice financial fields are immutable'); END;

CREATE TRIGGER trg_invoice_lines_no_update BEFORE UPDATE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'Invoice lines are immutable'); END;
CREATE TRIGGER trg_invoice_lines_no_delete BEFORE DELETE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'Invoice lines cannot be deleted'); END;

CREATE TRIGGER trg_payments_no_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'Payments are immutable'); END;
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'Payments cannot be deleted'); END;

CREATE TRIGGER trg_returns_no_update BEFORE UPDATE ON returns
BEGIN SELECT RAISE(ABORT, 'Returns are immutable'); END;
CREATE TRIGGER trg_returns_no_delete BEFORE DELETE ON returns
BEGIN SELECT RAISE(ABORT, 'Returns cannot be deleted'); END;

CREATE TRIGGER trg_movements_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Inventory movements are immutable'); END;
CREATE TRIGGER trg_movements_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Inventory movements cannot be deleted'); END;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;
`;

/** v2: remember who last confirmed each catalogue entry. */
const m2 = `
ALTER TABLE products ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE products ADD COLUMN reviewed_at TEXT;
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial schema', sql: m1 },
  { version: 2, name: 'catalogue review attribution', sql: m2 },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
