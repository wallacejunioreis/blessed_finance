# Security Specification — Blessed Finance

## 1. Data Invariants
1. **Family Isolation (Zero Cross-Family Access):** No user can read, list, create, update, or delete any financial document under `/families/{familyId}/...` unless `/families/{familyId}/members/$(request.auth.uid)` exists.
2. **PII Isolation:** `/users/{userId}` contains private email and profile state and may ONLY be read or written by `request.auth.uid == userId`.
3. **Verified Identity:** All read/write operations require `request.auth != null` and `request.auth.token.email_verified == true`.
4. **Immutable Authorship & Timestamps:** `createdAt` and `createdByUid` / `ownerId` / `performedByUid` cannot be forged or altered after creation; `createdAt` and `updatedAt` must strictly equal `request.time`.
5. **Invite Code Integrity:** Users cannot list `/families` or `/familyInvites`. Joining a family requires knowing an active invite code and validating `/families/{familyId}/members/$(request.auth.uid)` creation against `/familyInvites/{inviteCode}`.
6. **Terminal State & Amount Boundaries:** Financial amounts must be positive numbers (`> 0` where applicable), strings bounded by `maxLength`, and document IDs validated with `^[a-zA-Z0-9_\\-]+$`.
7. **Immutable Audit Trail:** `auditLogs` documents are append-only (`allow update, delete: if false`).

## 2. The "Dirty Dozen" Attack Payloads
1. **Cross-Family Read:** User B (member of `famB`) tries `get /families/famA/incomes/inc1` -> `PERMISSION_DENIED`.
2. **Blanket Family List:** Authenticated user tries `list /families` -> `PERMISSION_DENIED`.
3. **Blanket Invite Enumeration:** Authenticated user tries `list /familyInvites` -> `PERMISSION_DENIED`.
4. **PII Leak on Users:** User B tries `get /users/userA` -> `PERMISSION_DENIED`.
5. **Shadow Ghost Field:** Family member sends `{ ...validIncome, isAdmin: true }` -> `PERMISSION_DENIED`.
6. **Identity Spoofing on Create:** User A tries creating an expense with `createdByUid: "userB"` -> `PERMISSION_DENIED`.
7. **Unverified Email Bypass:** User with `email_verified: false` tries to create a family -> `PERMISSION_DENIED`.
8. **Timestamp Forgery:** User sends `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> `PERMISSION_DENIED`.
9. **ID Poisoning:** User tries creating `/families/famA/expenses/<200-char-invalid-id!>` -> `PERMISSION_DENIED`.
10. **Negative / Zero Financial Amount:** User tries creating an income with `amount: -500` -> `PERMISSION_DENIED`.
11. **Audit Log Tampering:** Family member tries updating or deleting `/families/famA/auditLogs/log1` -> `PERMISSION_DENIED`.
12. **Member Escalation / Self-Join Without Invite:** Non-member tries writing `/families/famA/members/attackerUid` with fake `inviteCode: "FAKE123"` -> `PERMISSION_DENIED`.
