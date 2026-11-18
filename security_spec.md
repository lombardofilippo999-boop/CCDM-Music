# Security Specification — CCDM Music

## 1. Data Invariants
1. **Master Source of Truth for RBAC**: User roles (`admin`, `editor`, `viewer`) are enforced exclusively by `/users/{userId}` and `/admins/{userId}` + verified owner email (`lombardofilippo999@gmail.com`). Users can NEVER self-assign `admin` or `editor` roles without either matching the bootstrapped verified owner email or atomically redeeming an active, valid `/invites/{code}` document matching that exact role.
2. **Account Deletion Preservation**: Deleting a member (`/users/{userId}`, `/users/{userId}/private/info`, `/admins/{userId}`) MUST NEVER cascade-delete `/songs/{songId}` or `/setlists/{setlistId}`. Songs and setlists remain in the band library permanently unless explicitly deleted by an Admin or Editor.
3. **PII Isolation**: Member email addresses live strictly in `/users/{userId}/private/info`, readable only by the owner or an Admin. Public `/users/{userId}` documents contain zero PII.
4. **Editor Boundaries**: Editors can create, update, and delete `/songs/{songId}` (plus chunks) and `/setlists/{setlistId}`, but CANNOT create/delete invite codes and CANNOT delete or modify other users in `/users/{userId}`.
5. **Viewer Boundaries**: Viewers MUST redeem an active `viewer` invite code during registration (`role: 'viewer'`), can read `/songs`, `/songs/{songId}/chunks`, and `/setlists`, and update/delete only their own profile, but CANNOT create/update/delete songs, setlists, or invites.
6. **Temporal & Relational Integrity**: All `createdAt` / `joinedAt` / `updatedAt` timestamps must match `request.time`. Immutable ownership fields (`uid`, `uploadedByUid`, `createdByUid`, `createdAt`, `joinedAt`) cannot be altered on update.
7. **Invite Code Atomicity**: Redeeming an invite code for any role (`viewer`, `editor`, or `admin`) is mandatory (except verified owner bootstrap) and requires atomically incrementing `usedCount` by `1` in the same batch (`getAfter` / `existsAfter`).

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Self-Assigned Admin**: Unprivileged user creates `/users/{uid}` with `role: "admin"` and `inviteCodeUsed: ""`.
2. **Registration Without Invite Code**: Unprivileged user creates `/users/{uid}` with `role: "viewer"` or `role: "editor"` and `inviteCodeUsed: ""` or `"FAKE-CODE"`.
3. **Role Mismatch Invite Redemption**: User redeems a `viewer` invite code while setting `role: "editor"` on `/users/{uid}`.
4. **Exhausted Invite Replay**: User attempts to redeem an invite code where `usedCount >= maxUses` or `active == false`.
5. **Privilege Escalation Update**: Editor updates their own `/users/{uid}` setting `role: "admin"`.
6. **Editor Deleting Member**: Editor attempts `DELETE /users/{otherUid}`.
7. **Shadow Field Injection**: Editor creates `/songs/{id}` with all required fields plus ghost field `isVerified: true`.
8. **Unverified Email Spoofing**: User with `email: "lombardofilippo999@gmail.com"` and `email_verified: false` attempts to create `/admins/{uid}`.
9. **PII Blanket Read**: Viewer attempts `GET /users/{otherUid}/private/info`.
10. **Viewer Mutating Song**: Viewer attempts `CREATE` or `DELETE` on `/songs/{songId}` or `/setlists/{setlistId}`.
11. **Path ID Poisoning**: User attempts `CREATE /songs/invalid$id!with@spaces` or 200-char ID.
12. **Client Timestamp Forgery**: Editor creates `/songs/{songId}` with backdated `createdAt` instead of `request.time`.
