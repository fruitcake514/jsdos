let allGames = [];
let dosInstance = null;
const DosFactory = window.Dos;

if (window.emulators) {
  window.emulators.pathPrefix = "/vendor/jsdos-v7/";
}

const gallery = document.getElementById("gallery");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("search");
const player = document.getElementById("player");

function render(games) {
  gallery.innerHTML = "";

  games.forEach((game, idx) => {
    const card = document.createElement("article");
    card.className = "card";
    card.style.animationDelay = `${Math.min(idx * 0.02, 0.4)}s`;

    const title = document.createElement("p");
    title.className = "title";
    title.textContent = game.title;

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `${game.source} - ${game.relPath}`;

    const play = document.createElement("button");
    play.className = "play";
    play.textContent = "Play";
    play.addEventListener("click", () => launchGame(game));

    card.append(title, meta, play);
    gallery.appendChild(card);
  });
}

async function launchGame(game) {
  statusEl.textContent = `Preparing ${game.title}...`;
  try {
    if (typeof DosFactory !== "function") {
      throw new Error("js-dos runtime did not load");
    }

    const launchPath = encodeURIComponent(game.relPath).replace(/%2F/g, "/");
    const rsp = await fetch(`/api/launch/${encodeURIComponent(game.source)}/${launchPath}`);
    if (!rsp.ok) {
      const err = await rsp.json();
      throw new Error(err.error || "Cannot launch this game");
    }

    const launch = await rsp.json();

    if (dosInstance && typeof dosInstance.stop === "function") {
      await dosInstance.stop();
      dosInstance = null;
    } else if (dosInstance && typeof dosInstance.exit === "function") {
      await dosInstance.exit();
      dosInstance = null;
    }

    player.innerHTML = "";
    dosInstance = DosFactory(player, { kiosk: true });
    if (!dosInstance || typeof dosInstance.run !== "function") {
      throw new Error("js-dos v7 API missing run(); check script loading");
    }

    await dosInstance.run(launch.bundle);

    statusEl.textContent = `Playing ${game.title}`;
  } catch (err) {
    console.error("Launch error", err);
    statusEl.textContent = `Launch failed: ${err.message}`;
  }
}

async function boot() {
  try {
    const rsp = await fetch("/api/games");
    const data = await rsp.json();
    allGames = data.games || [];
    statusEl.textContent = `${data.total} games found`;
    render(allGames);
  } catch {
    statusEl.textContent = "Failed to scan game libraries";
  }
}

searchInput.addEventListener("input", (e) => {
  const term = String(e.target.value || "").trim().toLowerCase();
  const filtered = term
    ? allGames.filter((g) => g.title.toLowerCase().includes(term) || g.relPath.toLowerCase().includes(term))
    : allGames;
  render(filtered);
});

boot();
