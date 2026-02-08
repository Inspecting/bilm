BILM is a movie and TV show browsing site that lets users:

Browse a wide selection of movies and TV shows in one place

Discover new, trending, and popular titles quickly

Preview content sourced from other streaming services

Switch easily between movies and TV series

Use a clean, simple interface designed for fast navigation

Explore titles before choosing where to watch them

BILM is built for discovery and convenience, helping users find what to watch without jumping between multiple platforms.

Visit the site here:
👉 https://inspecting.github.io/bilm

👉 Direct Link: https://inspecting.github.io/bilm/home/

## Optional Supabase Login & Sync
You can enable Google login + username/email/password to sync data across devices. This is optional; the site still works with local-only storage if you skip it.

**Quick setup**
1. Create a Supabase project.
2. Go to **Project Settings → API** and copy your **Project URL** + **anon key**.
3. Open `/bilm/auth/` and paste those values into **Supabase Setup**.
4. In Supabase → SQL Editor, run the SQL shown on the account page to create the `profiles` and `user_data` tables + policies.
5. (Optional) In **Authentication → Providers**, enable Google and add your site URL to the redirect list.

**Notes**
- Users can sign up with a username only; we create an internal email (`username@bilm.local`) for Supabase under the hood.
- The desktop navbar shows the username when logged in. Mobile users can access login via **Settings → Account**.
