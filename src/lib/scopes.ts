export const TOKEN_SCOPES = ["tasks:read", "tasks:write", "tasks:propose", "reviews:write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const SCOPE_LABEL: Record<TokenScope, string> = {
  "tasks:read": "Read tasks",
  "tasks:write": "Claim and update tasks",
  "tasks:propose": "Propose new tasks",
  "reviews:write": "Record reviews",
};
