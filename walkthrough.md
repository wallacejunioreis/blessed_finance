# Security Summary

**Reviewed Files**: 22  
**Issues Resolved**: 5  

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Vulnerable Excel Dependency | `package.json` | 30 | Used `xlsx@0.18.5` (SheetJS), which carries known Prototype Pollution and ReDoS advisories. | High | Fixed | Removed `xlsx` completely and migrated Excel `.xlsx` exports to `write-excel-file/browser` (`src/utils/exportReports.ts`). |
| Sensitive Metadata & Error Leakage | `src/firebase.ts`, `src/components/ErrorBoundary.tsx` | 48, 22 | `handleFirestoreError` logged user email and provider details to `console.error`, and `ErrorBoundary` rendered raw JSON error strings (including paths/UIDs) in the UI. | Medium | Fixed | Removed PII (`email`, `providerInfo`) from console logs and replaced raw error output in `ErrorBoundary` with a generic, safe Portuguese recovery message. |
| Unvalidated JSON Backup Upload & Prototype Pollution | `src/components/FamilySettingsView.tsx`, `src/contexts/FinanceContext.tsx` | 150, 972 | JSON restore accepted files without size/extension checks, parsed JSON without stripping `__proto__`/`constructor`/`prototype`, and allowed arbitrary unvalidated IDs and dates. | Medium | Fixed | Added 2 MB size cap and `.json` validation, introduced `parseAndValidateBackupJSON` with a prototype-pollution-blocking JSON reviver, enforced strict date (`YYYY-MM-DD`) and alphanumeric ID regex checks, and required user reauthentication before restoring. |
| Missing HTTP Security Headers, CSP & Rate Limiting | `server.ts` | 1 | App ran directly on Vite dev server without HTTP security headers (`Content-Security-Policy`, `HSTS`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`), origin verification, or rate limiting. | Medium | Fixed | Added hardened Express server (`server.ts`) setting CSP, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, HTTPS proxy redirect, sliding-window rate limiter, and same-origin verification on `/api/*`. |
| Missing Reauthentication & Owner Self-Lockout Guard | `src/contexts/AuthContext.tsx`, `firestore.rules` | 346, 319 | Sensitive operations (regenerating invite code, revoking member access, restoring backups) lacked recent reauthentication, and `firestore.rules` allowed the family owner to delete their own membership document. | Medium | Fixed | Implemented `reauthenticateUser`, `changeUserPassword`, `removeFamilyMember`, 30-minute inactivity auto-signout, URL invite parameter cleanup, and a Firestore rule blocking owner self-deletion and enforcing strict `isValidId` on `responsibleUid`. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Google OAuth Minimal Scopes | `src/firebase.ts` | `createMinimalGoogleProvider()` requests only `profile` and `email` scopes with `prompt: 'select_account'`, never requesting Gmail, Drive, Contacts, or Photos access. |
| Environment & Secret Hygiene | `.env.example`, `.gitignore` | `.env.example` holds empty variable declarations only; `.env*` files are excluded from Git; no private keys or secrets exist in client bundles. |
| Database Isolation & Schema Validation | `firestore.rules`, `firebase-blueprint.json` | Default-deny catch-all rule (`allow read, write: if false`), verified-email gate (`email_verified == true`), Master Gate family membership (`exists(/families/{familyId}/members/$(request.auth.uid))`), strict key allowlists (`hasOnly`), bounded string/number checks, and immutable append-only `auditLogs`. |
| App Check Support | `src/firebase.ts` | Supports optional Firebase App Check (`ReCaptchaV3Provider`) via `VITE_FIREBASE_APP_CHECK_SITE_KEY` without exposing private keys. |
| XSS & Safe Rendering | `src/components/*.tsx` | All user-supplied values (descriptions, notes, names) render via React JSX text bindings with zero `dangerouslySetInnerHTML`, `innerHTML`, or unvalidated dynamic URLs. |

---

## PoC Verification

### 1. Malicious JSON Backup Upload with Prototype Pollution & Invalid Date
#### Summary
| Field | Value |
|---|---|
| Issue Type | Prototype Pollution / Unvalidated File Restore |
| Impact | Medium |
| Affected File | `src/utils/exportReports.ts:104`, `src/contexts/FinanceContext.tsx:972` |
| Test Scenario | Uploading a crafted JSON file containing `{"app":"Blessed Finance","version":1,"__proto__":{"polluted":true},"incomes":[{"id":"../../bad!","amount":-500,"date":"invalid-date"}],"expenses":[]}` |

#### How It Was Fixed
`FamilySettingsView.tsx` enforces a `.json` extension and 2 MB size cap before calling `parseAndValidateBackupJSON`, which uses a `JSON.parse` reviver to discard `__proto__`, `constructor`, and `prototype` keys. Additionally, the user must complete reauthentication before `restoreBackup` executes, and `restoreBackup` skips invalid/negative amounts while sanitizing IDs and `YYYY-MM-DD` dates.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Malicious `.json` file is selected in `FamilySettingsView.tsx:147` | File extension and `<= 2 MB` size checked |
| 2 | `parseAndValidateBackupJSON` (`exportReports.ts:109`) parses text with reviver | `__proto__` key is stripped and discarded (`undefined`) |
| 3 | User is prompted for reauthentication (`FamilySettingsView.tsx:167`) | Prevents unauthorized restore on an unattended session |
| 4 | `restoreBackup` (`FinanceContext.tsx:990`) checks `amt <= 0` and `isSafeId`/`isSafeDate` | Negative/invalid record is skipped; invalid ID cannot reach Firestore |

#### Conclusion
**Fix Verified** - Prototype pollution keys, oversized uploads, and malformed financial backup entries are neutralized before reaching Firestore.

---

### 2. Sensitive Metadata Exposure in Error Logs and Error Boundary UI
#### Summary
| Field | Value |
|---|---|
| Issue Type | Internal Information & PII Exposure |
| Impact | Medium |
| Affected File | `src/firebase.ts:48`, `src/components/ErrorBoundary.tsx:22` |
| Test Scenario | A Firestore permission denial occurs while an authenticated user (`email: usuario@exemplo.com`) performs a write on `/families/fam_1/incomes/inc_1`. |

#### How It Was Fixed
`handleFirestoreError` strips `email` and `providerInfo` from the logged/thrown payload and logs only a generic operation marker to the browser console, while `ErrorBoundary` renders a static Portuguese recovery message without displaying internal JSON, UIDs, or collection paths.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Firestore error reaches `handleFirestoreError` (`src/firebase.ts:48`) | `email` and `providerInfo` are omitted; console prints generic operation tag only |
| 2 | Error bubbles to `ErrorBoundary.getDerivedStateFromError` (`ErrorBoundary.tsx:15`) | Returns `{ hasError: true }` without storing raw error text in component state |
| 3 | `ErrorBoundary.render()` displays Portuguese recovery UI | User sees friendly recovery prompt; zero internal paths or PII rendered |

#### Conclusion
**Fix Verified** - Internal database paths, user emails, and raw stack traces are never exposed to browser logs or the rendered UI.

---

### 3. Missing HTTP Security Headers and Cross-Origin API Guard
#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Security Headers & Unprotected API Origin |
| Impact | Medium |
| Affected File | `server.ts:29`, `server.ts:95` |
| Test Scenario | Automated burst of >90 requests/min or a cross-origin `POST /api/health` request with `Origin: https://evil.example`. |

#### How It Was Fixed
`server.ts` applies CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy` on all responses, plus `apiRateLimiter` (90 req/min/IP) and `verifyRequestOrigin` on `/api/*`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Request arrives at Express middleware (`server.ts:29`) | Strict CSP, HSTS, and security headers are attached |
| 2 | `/api/*` request enters `apiRateLimiter` (`server.ts:61`) | Requests above 90/min receive HTTP `429` with `Retry-After` |
| 3 | State-changing request enters `verifyRequestOrigin` (`server.ts:95`) | Cross-origin mismatch returns HTTP `403` |

#### Conclusion
**Fix Verified** - All responses enforce strict browser security headers, and `/api/*` endpoints block bursts and unauthorized cross-origin mutations.
