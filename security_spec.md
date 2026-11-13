# Cosmic Crisp Firestore Security Specification

## 1. Data Invariants
1. Every `FieldParcel` document in `/fields/{fieldId}` belongs to a single verified Firebase Auth user (`ownerId == request.auth.uid`, `email_verified == true`).
2. `FieldParcel.id` must match its document ID `{fieldId}` and pass `isValidId()`, preventing path poisoning or oversized IDs.
3. `FieldParcel.ownerId` and `FieldParcel.createdAt` are immutable after creation.
4. `createdAt` and `updatedAt` are strictly enforced against `request.time` via Firestore `serverTimestamp()`.
5. Every `FieldActivity` in `/fields/{fieldId}/activities/{activityId}` is bound to an existing parent `FieldParcel` owned by the same user (`get(/databases/$(database)/documents/fields/$(fieldId)).data.ownerId == request.auth.uid`).
6. No blanket reads or client-delegated list queries: every `list` rule evaluates `resource.data.ownerId == request.auth.uid`.
7. GeoJSON polygons are stored as native Firestore Maps and Lists (`geometryRings`), never serialized JSON strings or nested arrays.

## 2. Dirty Dozen Adversarial Payloads
1. **Unauthenticated Create**: Unauthenticated POST to `/fields/f1` -> `PERMISSION_DENIED` (`isSignedIn()` fails).
2. **Unverified Email Spoof**: Signed-in token with `email_verified: false` attempting create on `/fields/f1` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Ownership Spoof**: User A sets `ownerId: "userB"` on `/fields/f1` -> `PERMISSION_DENIED` (`incoming().ownerId == request.auth.uid` fails).
4. **Shadow Ghost Field Injection**: User A includes `isAdmin: true` or `extraField: 1` in `/fields/f1` -> `PERMISSION_DENIED` (`hasOnly` rejects).
5. **Oversized ID Poisoning**: Document ID > 128 chars or containing `/` / `$` -> `PERMISSION_DENIED` (`isValidId()` fails).
6. **Oversized Name / Notes DoW**: `name` > 140 chars or `notes` > 2000 chars -> `PERMISSION_DENIED`.
7. **Unbounded Array Injection**: `yields` with > 50 elements or `previous_crops` with > 10 elements -> `PERMISSION_DENIED`.
8. **Invalid Analysis Status**: `analysis_status: "hacked"` -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: `createdAt` or `updatedAt` set to past/future client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
10. **Immutable Owner Tampering**: Update changing `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
11. **Orphaned Activity Injection**: Creating `/fields/missingField/activities/a1` -> `PERMISSION_DENIED` (`exists()` on parent fails).
12. **Blanket Collection Scrape**: `list` query on `/fields` without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED` (`resource.data.ownerId == request.auth.uid` rejects).
