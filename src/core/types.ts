import type { Permission } from '../shared/permissions';
import type { Db } from './db/connection';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  roleLabel: string;
  permissions: Permission[];
}

/** Context handed to every service call. */
export interface Ctx {
  db: Db;
  user: SessionUser;
  now: () => Date;
  /** Set when a supervisor with the required permission approved the operation. */
  approver?: { id: number; username: string } | null;
}

export interface Approval {
  username: string;
  password: string;
}
