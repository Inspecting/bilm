# Cloudflare data architecture recommendation for BILM

## TL;DR

Use a **hybrid Cloudflare stack**:

1. **Cloudflare R2** for object/blob data (JSON exports, uploaded media assets, backup archives, logs).
2. **Cloudflare D1** for relational account/app data (users, profile metadata, history, favorites, watch later).
3. **Cloudflare Durable Objects (optional)** for realtime/shared chat if you want live room/session behavior.
4. Keep **localStorage** as a fast local cache, but sync authoritative data to D1 (or Durable Objects for chat).

This replaces the current Firebase Auth + Firestore approach while preserving current product behavior.

---

## Current state found in this repository

### Current cloud provider usage

- The app currently initializes Firebase and uses:
  - Firebase Auth (email/password).
  - Firestore documents under `users/{uid}`.
  - Firestore `usernames` mapping for username lookup.
  - Firestore `users/{uid}/sharedChat` subcollection for chat.
- Cloud sync today stores a full browser snapshot (`localStorage` + `sessionStorage` allowlisted keys) into `users/{uid}.cloudBackup.snapshot`.

### Data categories currently present

1. **Account/Auth metadata**
   - Email, username, UID.
2. **User preference/history lists** (currently browser storage + cloud snapshot sync)
   - favorites
   - watch later
   - continue watching / watch history
   - search history
3. **Shared chat messages**
   - Text + author metadata + created timestamp, currently in Firestore.
4. **Export/import backup payloads**
   - JSON payload that can represent local/session storage data.

---

## Recommended target architecture

## 1) Authentication and identities

Best option for your quota concerns:

- Move to **Cloudflare Access / external IdP token verification** (Google/GitHub/etc.) OR lightweight custom email auth backed by D1.
- If you need email-password without building auth logic, consider a dedicated auth provider and keep Cloudflare for data plane.

Minimum identity model:

- `users(id, email, username, created_at, updated_at)`
- `user_identities(user_id, provider, provider_subject)` (optional)

## 2) Structured user/app data (D1)

Put all list-like user data in D1 rows instead of monolithic blob snapshots:

- `favorites(user_id, media_type, media_id, updated_at)`
- `watch_later(user_id, media_type, media_id, updated_at)`
- `watch_history(user_id, media_type, media_id, progress_seconds, watched_at, updated_at)`
- `search_history(user_id, query, updated_at)`

Why this is better than storing one big JSON snapshot:

- Easier partial updates.
- Better quota behavior vs rewriting large documents repeatedly.
- Query/filter/paginate by time/type.
- Easier moderation/deletes/retention controls.

## 3) Chat data

You have two strong options:

- **Option A: D1 only** (simplest): store messages in `chat_messages` table and poll or short refresh intervals.
- **Option B: Durable Objects + D1** (best realtime):
  - Durable Object coordinates live session and fanout.
  - Persist each message to D1 for history/audit.

For your current "shared account chat" use case, Option B is best if realtime UX matters.

## 4) Object storage (R2)

Use R2 only for object/blob files:

- backup JSON files uploaded/downloaded by users
- optional exported analytics/log files
- future user-generated uploads (avatars, screenshots, attachments)

Do **not** put core relational entities (favorites/history/chat metadata) exclusively in R2; use D1 for that.

---

## Migration path from Firebase to Cloudflare

1. **Inventory and map data**
   - `users` doc => `users` table
   - `usernames` collection => `users.username` unique index
   - `cloudBackup.snapshot` => parsed rows in history/favorites/watch-later/search tables
   - `users/{uid}/sharedChat` => `chat_messages`
2. **Build dual-write API** behind Cloudflare Worker
   - While migrating, write to Firebase and Cloudflare.
3. **Backfill existing records**
   - Export Firestore data and transform to D1 import format.
4. **Read switch**
   - Move reads to Cloudflare API first, keep Firebase fallback temporarily.
5. **Cutover**
   - Disable Firebase writes after validation period.
6. **Decommission**
   - Keep archived backup in R2, then remove Firebase dependency.

---

## Practical answer: "Is R2 a good idea for all my current site data?"

- **R2 alone** for everything: **No** (not ideal).
- **R2 + D1 (+ Durable Objects for chat)**: **Yes, this is the best fit** for this app.

If you want, next step can be a concrete `schema.sql` + Worker API contract that matches your existing keys and endpoints.
