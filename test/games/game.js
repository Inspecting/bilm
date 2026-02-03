      const apiKey = "3c83888951ef4d339550cc88bcaf681d";
      const apiBase = "https://api.rawg.io/api";

      const theme = localStorage.getItem("gameTheme") || "dark";
      document.documentElement.dataset.theme = theme;

      document.getElementById("toggle-theme").addEventListener("click", () => {
        const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = nextTheme;
        localStorage.setItem("gameTheme", nextTheme);
      });

      const params = new URLSearchParams(window.location.search);
      const gameId = params.get("id");

      const elements = {
        loading: document.getElementById("loading"),
        error: document.getElementById("error"),
        hero: document.getElementById("hero"),
        heroImage: document.getElementById("hero-image"),
        title: document.getElementById("title"),
        meta: document.getElementById("meta"),
        genres: document.getElementById("genres"),
        description: document.getElementById("description"),
        website: document.getElementById("website"),
        extras: document.getElementById("extras"),
        highlights: document.getElementById("highlights"),
        stores: document.getElementById("stores"),
        storeList: document.getElementById("store-list"),
      };

      const buildPill = (label) => {
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = label;
        return pill;
      };

      const renderHighlights = (game) => {
        elements.highlights.innerHTML = "";
        const items = [
          { label: "Playtime", value: `${game.playtime || 0} hrs` },
          { label: "ESRB", value: game.esrb_rating?.name || "Not rated" },
          { label: "Suggestions", value: game.suggestions_count || 0 },
          { label: "Screenshots", value: game.screenshots_count || 0 },
        ];

        items.forEach((item) => {
          const card = document.createElement("div");
          card.innerHTML = `<strong>${item.label}</strong><p>${item.value}</p>`;
          elements.highlights.appendChild(card);
        });
      };

      const renderStores = (stores) => {
        elements.storeList.innerHTML = "";
        if (!stores.length) return;

        stores.forEach((store) => {
          const card = document.createElement("div");
          card.innerHTML = `
            <strong>${store.store.name}</strong>
            <p>${store.url ? "Available" : "Link coming soon"}</p>
            ${store.url ? `<a class="link" href="${store.url}" target="_blank" rel="noreferrer">Open store →</a>` : ""}
          `;
          elements.storeList.appendChild(card);
        });
      };

      const loadGame = async () => {
        if (!gameId) {
          elements.loading.hidden = true;
          elements.error.hidden = false;
          elements.error.textContent = "Missing game id.";
          return;
        }

        try {
          const response = await fetch(`${apiBase}/games/${gameId}?key=${apiKey}`);
          if (!response.ok) throw new Error("Unable to load game");
          const game = await response.json();

          elements.title.textContent = game.name;
          elements.heroImage.src = game.background_image || "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=1200&q=60";
          elements.heroImage.alt = game.name;
          elements.description.innerHTML = game.description || "No description available.";

          elements.meta.append(
            buildPill(`⭐ ${game.rating?.toFixed(1) || "N/A"}`),
            buildPill(game.released || "TBA"),
            buildPill(game.metacritic ? `MC ${game.metacritic}` : "No score")
          );

          elements.genres.innerHTML = "";
          game.genres?.forEach((genre) => {
            const chip = document.createElement("span");
            chip.className = "chip";
            chip.textContent = genre.name;
            elements.genres.appendChild(chip);
          });

          if (game.website) {
            elements.website.href = game.website;
            elements.website.hidden = false;
          } else {
            elements.website.hidden = true;
          }

          renderHighlights(game);
          elements.extras.hidden = false;

          const storesResponse = await fetch(`${apiBase}/games/${gameId}/stores?key=${apiKey}`);
          const storesData = await storesResponse.json();
          if (storesData.results?.length) {
            renderStores(storesData.results);
            elements.stores.hidden = false;
          }

          elements.loading.hidden = true;
          elements.hero.hidden = false;
        } catch (error) {
          elements.loading.hidden = true;
          elements.error.hidden = false;
          elements.error.textContent = error.message;
        }
      };

      loadGame();
