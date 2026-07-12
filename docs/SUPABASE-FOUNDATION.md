# Supabase foundation setup

This is the first Media Room Supabase pass. It creates the data model and database-enforced permissions only. The current GitHub Pages interface remains static and unchanged.

## What this migration provides

- Multi-user profiles, one collection per user, dynamic shelves, media items, and per-shelf ordering.
- Public read access for collections, shelves, media, and future interest markers.
- Write access enforced with Supabase Row Level Security (RLS): only an approved collection owner or an admin can change a collection.
- Pending registrations: a user created by Supabase Auth automatically receives an unapproved `profiles` row and can browse but cannot write. Approval and rejection are recorded separately.
- A private `profiles` table plus a restricted `public.public_profiles` view for future collection navigation.
- A dormant `media_interest` table for the later “Priority watch” feature. No interface or application behaviour uses it yet.

Passwords are not stored in this schema, the repository, or the browser application. Supabase Auth handles password storage and verification. The future login screen should advise people not to reuse an important password, and should encourage recognisable real names for this private social group.

## Apply the migration

1. Create a Supabase project. Do not add the service-role key to this repository or any browser code.
2. In the Supabase Dashboard, open **SQL Editor**.
3. Paste and run [the foundation migration](../supabase/migrations/20260712050000_media_room_foundation.sql).
4. In **Authentication → Providers**, enable the intended password provider. Authentication UI is deliberately deferred to the user-system pass.
5. Verify that all six tables show RLS enabled: `profiles`, `collections`, `shelves`, `media_items`, `shelf_media_items`, and `media_interest`.

Using the Supabase CLI later is also supported; this repository now follows the standard `supabase/migrations` layout.

## Bootstrap Christopher as the first admin

After Christopher has created an Auth account and the trigger has created their profile, find that account’s UUID in **Authentication → Users**. Run the following in the SQL Editor, replacing the placeholder:

```sql
update public.profiles
set
  role = 'admin',
  approved_at = now(),
  approved_by = id
where id = 'AUTH-USER-UUID-HERE';
```

This is intentionally a manual, one-time database-admin action. It avoids any unsafe “first person to claim the Christopher username becomes admin” rule.

## Security checks

Run these checks after setting up a test member and a test collection:

- An anonymous browser session can select public collection, shelf, and media data.
- An unapproved user can select data but cannot insert or update a collection.
- An approved user can modify only their own collection.
- An approved user cannot modify another user’s collection, shelves, media, or ordering.
- A regular user cannot update another profile or change approval/admin fields.
- An admin can approve/reject users and moderate any collection. A later server-side admin endpoint, never browser code, will delete Auth accounts.

The policy helper functions are security-definer functions used only for RLS decisions. They are not an API for changing data.

## Intentionally deferred

- Connecting the Vite application to Supabase.
- Importing Kit’s JSON collection into the database.
- Sign-in, registration, approval, and admin screens.
- Collection navigation, media/shelf CRUD, and drag-to-reorder.
- Priority-watch controls and the aggregate watchlist.

Those belong to later, separately tested passes.
