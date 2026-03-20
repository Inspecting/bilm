BILM is a movie and TV show browsing site that lets users:

Browse a wide selection of movies and TV shows in one place

Discover new, trending, and popular titles quickly

Preview content sourced from other streaming services

Switch easily between movies and TV series

Use a clean, simple interface designed for fast navigation

Explore titles before choosing where to watch them

BILM is built for discovery and convenience, helping users find what to watch without jumping between multiple platforms.

Even includes anime for wide variation between your preferences.

## jsDelivr mirror deployment

This repo supports a jsDelivr-hosted mirror from GitHub tags.

1. Create a tag: `git tag vX.Y.Z`
2. Push the tag: `git push origin vX.Y.Z`
3. Open the mirror URL:
   `https://cdn.jsdelivr.net/gh/Inspecting/bilm@vX.Y.Z/index.html`
4. If cache is stale, purge on jsDelivr and reload.

When running on `cdn.jsdelivr.net`, frontend `/api/*` fallbacks are routed to `https://watchbilm.org` so no new API service is required.
