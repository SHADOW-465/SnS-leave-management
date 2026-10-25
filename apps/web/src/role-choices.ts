const PRIVILEGED = ['admin', 'director'];

/** Non-administrators cannot tick administrator or managing director. */
export function roleChoiceLocked(actorIsAdmin: boolean, roleCode: string): boolean {
  return !actorIsAdmin && PRIVILEGED.includes(roleCode);
}

/** Non-administrators cannot edit an account that already has administrator or director. */
export function canEditRoleSet(actorIsAdmin: boolean, roles: readonly string[]): boolean {
  return actorIsAdmin || !roles.some((role) => PRIVILEGED.includes(role));
}
