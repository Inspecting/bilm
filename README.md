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

## Optional Login & Sync
Login is built into the site with Supabase. Users can sign in with Google and sync data across devices. The site still works without logging in.

## Optional Supabase Login & Sync
You can enable Google login to sync data across devices. This is optional; the site still works with local-only storage if you skip it.

**Quick setup**
1. Create a Supabase project.
2. Go to **Project Settings → API** and copy your **Project URL** + **anon key**.
3. Update `shared/supabase-config.js` with your values (this repo now includes a default config).
3. Open `/bilm/auth/` and paste those values into **Supabase Setup**.
4. In Supabase → SQL Editor, run the SQL shown on the account page to create the `profiles` and `user_data` tables + policies.
5. (Optional) In **Authentication → Providers**, enable Google and add your site URL to the redirect list.

**Notes**
- The desktop navbar shows the account name when logged in. Mobile users can access login via **Settings → Account**.
