import { API_BASE_URL, apiFetch as fetchJson } from "../lib/api";

export type UserKind = "admin" | "picking" | "delivery";

export type AdminUser = {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  username: string;
  phone: string | null;
  isSuperuser: boolean;
  isActive: boolean;
  isPicker: boolean;
  kind: UserKind;
  driverId: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roles: { id: number; name: string }[];
};

export type Role = {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  permissionCount: number;
};

export type PermissionModule = {
  module: string;
  permissions: { id: number; code: string; description: string | null }[];
};

export type CreateUserPayload = {
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
  isSuperuser?: boolean;
  isActive?: boolean;
  isPicker?: boolean;
  roleIds?: number[];
};

export type UpdateUserPayload = Partial<Omit<CreateUserPayload, "password">>;



export const adminUsersService = {
  // Usuarios
  getUsers(kind?: UserKind): Promise<AdminUser[]> {
    const qs = kind ? `?kind=${kind}` : "";
    return fetchJson<AdminUser[]>(`${API_BASE_URL}/admin/users${qs}`);
  },

  createUser(payload: CreateUserPayload): Promise<AdminUser> {
    return fetchJson<AdminUser>(`${API_BASE_URL}/admin/users`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateUser(id: number, payload: UpdateUserPayload): Promise<AdminUser> {
    return fetchJson<AdminUser>(`${API_BASE_URL}/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  resetPassword(id: number, password: string): Promise<{ success: boolean }> {
    return fetchJson(`${API_BASE_URL}/admin/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  // Roles
  getRoles(): Promise<Role[]> {
    return fetchJson<Role[]>(`${API_BASE_URL}/admin/roles`);
  },

  createRole(payload: { name: string; description?: string }): Promise<Role> {
    return fetchJson<Role>(`${API_BASE_URL}/admin/roles`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateRole(
    id: number,
    payload: { name?: string; description?: string },
  ): Promise<Role> {
    return fetchJson<Role>(`${API_BASE_URL}/admin/roles/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deleteRole(id: number): Promise<{ success: boolean }> {
    return fetchJson(`${API_BASE_URL}/admin/roles/${id}`, {
      method: "DELETE",
    });
  },

  // Permisos
  getPermissions(): Promise<PermissionModule[]> {
    return fetchJson<PermissionModule[]>(`${API_BASE_URL}/admin/permissions`);
  },

  getRolePermissions(
    id: number,
  ): Promise<{ roleId: number; permissionCodes: string[] }> {
    return fetchJson(`${API_BASE_URL}/admin/roles/${id}/permissions`);
  },

  setRolePermissions(
    id: number,
    permissionCodes: string[],
  ): Promise<{ roleId: number; permissionCodes: string[] }> {
    return fetchJson(`${API_BASE_URL}/admin/roles/${id}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissionCodes }),
    });
  },
};
