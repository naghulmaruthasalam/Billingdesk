// Type-only re-exports of the data shapes returned by the main process (erased at build time).
export type { ProductDTO, CategoryDTO, CatalogueStatus, ProductInput } from '../../core/products';
export type { InvoiceDTO, InvoiceSummary, InvoiceLineDTO, PaymentDTO } from '../../core/billing';
export type { ReturnDTO } from '../../core/returns';
export type { CustomerDTO } from '../../core/customers';
export type { MovementRow, ValuationRow, ReconcileRow, StockCsvPreviewRow } from '../../core/inventory';
export type { SupplierDTO, PurchaseSummary } from '../../core/purchases';
export type { ExpenseDTO } from '../../core/expenses';
export type { UserDTO, RoleDTO } from '../../core/users';
export type { ReportTable, ReportColumn, DashboardDTO } from '../../core/reports';
export type { ImportPreview, ImportRow } from '../../core/catalogue-io';
export type { BackupInfo, BackupInspection, IntegrityResult } from '../../core/backup';
export type { AuditRow } from '../../core/audit';
export type { SessionUser } from '../../core/types';
export type { AllSettings } from '../../core/settings';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  node: string;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  lastBackupError: string | null;
}

export interface Approval {
  username: string;
  password: string;
}

export interface FileResult {
  filename: string;
  mime: string;
  text?: string;
  base64?: string;
}
