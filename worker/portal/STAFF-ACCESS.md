# Master Client Access

Framework staff with a grant open any active client's own portal (same pages, content and permissions) without being a member of it.

- **Grant**: table `portal_staff` (migration 0013, proposed). A grant starts as a lowercase email (seeded: hello@frameworkco.ca) and binds once, at that person's first verified WorkOS sign-in, to their portal user id. Authorization afterwards is by user id only; changing an email never moves a grant. Being an Admin Portal user grants nothing.
- **Enforcement**: `guard.js requireOrgAccess` re-reads the grant on every request, builds a synthetic membership (never a row), and returns `staff`. Routes, policy actions and org-scoped queries run unchanged. Staff writes use the explicit `asStaff` SQL predicates (`STAFF_MAY_WRITE`).
- **Role preview**: cookie `__Host-fw_view_role` (owner or member). It only picks what to show; anything else means owner. It never adds access.
- **Audit** (internal, never client-visible): `staff.portal.opened`, `staff.portal.write`, `staff.access.bound|granted|revoked`. Actor is `staff:<userId>`.
- **Attribution**: messages written by staff read "Framework" to clients and "<name> (Framework master access)" in Admin.
- **Admin API**: `GET/POST /api/admin/staff-access` (`grant` / `revoke` by email).
- **Not done by design**: no membership rows, no invitations, no client notifications, no staff entry in team lists.
