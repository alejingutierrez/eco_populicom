/**
 * Modelo de roles + capacidades (única fuente de verdad de RBAC del servidor).
 *
 * Tiers (de más a menos privilegio): admin > editor > analyst > viewer.
 * El rol vive en `users.role` (DB) y es la fuente de verdad de autorización;
 * los grupos de Cognito solo se usan como fallback de bootstrap (ver requireRole).
 *
 * /api/auth/me devuelve `role` + `capabilities` + `allowedPages` para que el SPA
 * gatee la navegación y los controles sin duplicar esta matriz en el cliente.
 */
export type Role = 'admin' | 'editor' | 'analyst' | 'viewer';

export const ROLE_TIERS: Role[] = ['admin', 'editor', 'analyst', 'viewer'];

export function isRole(s: unknown): s is Role {
  return typeof s === 'string' && (ROLE_TIERS as string[]).includes(s);
}

export type Capability =
  | 'manage_users'        // crear/editar/suspender usuarios y roles
  | 'manage_templates'    // ver/editar plantillas de correo + config de reportes
  | 'manage_alert_rules'  // crear/editar reglas de alerta (incl. crisis)
  | 'edit'                // acciones de escritura (responder menciones, etc.)
  | 'export';             // exportar datos

const ROLE_CAPS: Record<Role, Capability[]> = {
  admin:   ['manage_users', 'manage_templates', 'manage_alert_rules', 'edit', 'export'],
  editor:  ['manage_templates', 'manage_alert_rules', 'edit', 'export'],
  analyst: ['export'],
  viewer:  [],
};

export function capabilitiesFor(role: Role): Capability[] {
  return ROLE_CAPS[role] ?? [];
}

export function hasCapability(role: Role, cap: Capability): boolean {
  return capabilitiesFor(role).includes(cap);
}

/** Deriva un rol desde los grupos de Cognito (fallback de bootstrap/JIT). */
export function roleFromGroups(groups?: string[]): Role {
  if (groups?.includes('admin')) return 'admin';
  if (groups?.includes('editor')) return 'editor';
  if (groups?.includes('analyst')) return 'analyst';
  return 'viewer';
}
