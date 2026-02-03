      const apiKey = "3c83888951ef4d339550cc88bcaf681d";
      const apiBase = "https://api.rawg.io/api";
      const state = {
        page: 1,
        search: "",
        genre: "",
        platform: "",
        ordering: "-rating",
        view: localStorage.getItem("gameView") || "grid",
        theme: localStorage.getItem("gameTheme") || "dark",
        favorites: JSON.parse(localStorage.getItem("gameFavorites") || "[]"),
      };

      const elements = {
        stats: document.getElementById("stats"),
        grid: document.getElementById("game-grid"),
        empty: document.getElementById("empty"),
        loading: document.getElementById("loading"),
        search: document.getElementById("search"),
        genres: document.getElementById("genres"),
        platforms: document.getElementById("platforms"),
        sort: document.getElementById("sort"),
        toggleView: document.getElementById("toggle-view"),
        toggleTheme: document.getElementById("toggle-theme"),
        prev: document.getElementById("prev"),
        next: document.getElementById("next"),
        pageLabel: document.getElementById("page-label"),
      };

      const buildQuery = () => {
        const params = new URLSearchParams({
          key: apiKey,
          page: state.page,
          page_size: 18,
          ordering: state.ordering,
        });

        if (state.search) params.set("search", state.search);
        if (state.genre) params.set("genres", state.genre);
        if (state.platform) params.set("platforms", state.platform);

        return params.toString();
      };

      const setLoading = (isLoading) => {
        elements.loading.hidden = !isLoading;
      };

      const toggleTheme = () => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        localStorage.setItem("gameTheme", state.theme);
        document.documentElement.dataset.theme = state.theme;
      };

      const setView = (view) => {
        state.view = view;
        localStorage.setItem("gameView", state.view);
        elements.grid.classList.toggle("list", state.view === "list");
        elements.toggleView.textContent = state.view === "list" ? "List view" : "Grid view";
      };

      const updateStats = (count, total) => {
        elements.stats.textContent = `${count} games loaded · ${total} results`;
      };

      const renderGames = (games, total) => {
        elements.grid.innerHTML = "";
        elements.empty.hidden = games.length > 0;
        updateStats(games.length, total);

        games.forEach((game) => {
          const card = document.createElement("article");
          card.className = "card";

          const image = document.createElement("img");
          image.loading = "lazy";
          image.src = game.background_image || "https://images.unsplash.com/photo-1485988412941-77a35537dae4?auto=format&fit=crop&w=900&q=60";
          image.alt = game.name;

          const title = document.createElement("h3");
          title.textContent = game.name;

          const meta = document.createElement("div");
          meta.className = "meta";
          meta.innerHTML = `
            <span class="pill">⭐ ${game.rating?.toFixed(1) || "N/A"}</span>
            <span class="pill">${game.released || "TBA"}</span>
            <span class="pill">${game.metacritic ? `MC ${game.metacritic}` : "No score"}</span>
          `;

          const tags = document.createElement("div");
          tags.className = "meta";
          tags.innerHTML = (game.genres || []).slice(0, 3).map((genre) => `<span>${genre.name}</span>`).join(" · ");

          const actions = document.createElement("div");
          actions.className = "actions";

          const detailsLink = document.createElement("a");
          detailsLink.href = `game.html?id=${game.id}`;
          detailsLink.textContent = "View details";

          const favButton = document.createElement("button");
          const isFav = state.favorites.includes(game.id);
          favButton.textContent = isFav ? "Saved" : "Save";
          if (isFav) favButton.classList.add("active");

          favButton.addEventListener("click", () => {
            if (state.favorites.includes(game.id)) {
              state.favorites = state.favorites.filter((id) => id !== game.id);
            } else {
              state.favorites.push(game.id);
            }
            localStorage.setItem("gameFavorites", JSON.stringify(state.favorites));
            renderGames(games, total);
          });

          actions.append(detailsLink, favButton);
          card.append(image, title, meta, tags, actions);
          elements.grid.appendChild(card);
        });
      };

      const fetchGames = async () => {
        setLoading(true);
        try {
          const response = await fetch(`${apiBase}/games?${buildQuery()}`);
          if (!response.ok) throw new Error("Failed to load games");
          const data = await response.json();
          renderGames(data.results || [], data.count || 0);
          elements.pageLabel.textContent = `Page ${state.page}`;
          elements.prev.disabled = state.page === 1;
        } catch (error) {
          elements.grid.innerHTML = "";
          elements.empty.hidden = false;
          elements.empty.textContent = error.message;
        } finally {
          setLoading(false);
        }
      };

      const populateFilters = async () => {
        const [genresRes, platformsRes] = await Promise.all([
          fetch(`${apiBase}/genres?key=${apiKey}`),
          fetch(`${apiBase}/platforms?key=${apiKey}`),
        ]);

        const genresData = await genresRes.json();
        const platformsData = await platformsRes.json();

        genresData.results?.forEach((genre) => {
          const option = document.createElement("option");
          option.value = genre.slug;
          option.textContent = genre.name;
          elements.genres.appendChild(option);
        });

        platformsData.results?.slice(0, 20).forEach((platform) => {
          const option = document.createElement("option");
          option.value = platform.id;
          option.textContent = platform.name;
          elements.platforms.appendChild(option);
        });
      };

      elements.search.addEventListener("input", (event) => {
        state.search = event.target.value.trim();
        state.page = 1;
        fetchGames();
      });

      elements.genres.addEventListener("change", (event) => {
        state.genre = event.target.value;
        state.page = 1;
        fetchGames();
      });

      elements.platforms.addEventListener("change", (event) => {
        state.platform = event.target.value;
        state.page = 1;
        fetchGames();
      });

      elements.sort.addEventListener("change", (event) => {
        state.ordering = event.target.value;
        state.page = 1;
        fetchGames();
      });

      elements.toggleView.addEventListener("click", () => {
        setView(state.view === "grid" ? "list" : "grid");
      });

      elements.toggleTheme.addEventListener("click", toggleTheme);

      elements.prev.addEventListener("click", () => {
        if (state.page > 1) {
          state.page -= 1;
          fetchGames();
        }
      });

      elements.next.addEventListener("click", () => {
        state.page += 1;
        fetchGames();
      });

      document.documentElement.dataset.theme = state.theme;
      setView(state.view);
      populateFilters().then(fetchGames);
