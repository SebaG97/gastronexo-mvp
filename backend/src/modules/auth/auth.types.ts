export const membershipRoles = ['owner', 'admin', 'operator', 'viewer'] as const

export type MembershipRole = (typeof membershipRoles)[number]
