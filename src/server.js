const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 8080);
const exodosRoot = process.env.EXODOS_PATH || "/library/exodos";
const maxGames = Number(process.env.MAX_GAMES || 5000);

const STATIC_DIR = path.join(__dirname, "public");

function existsDir(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function safeRel(base, target) {
  const rel = path.relative(base, target).split(path.sep).join("/");
  if (rel.startsWith("..")) return null;
  return rel;
}

function isBundleFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".jsdos");
}

function detectEntry(files) {
  const candidates = ["play.bat", "start.bat", "run.bat", "game.bat", "install.bat"];
  const lowerMap = new Map(files.map((f) => [f.toLowerCase(), f]));
  for (const c of candidates) {
    if (lowerMap.has(c)) return lowerMap.get(c);
  }

  const exes = files.filter((f) => f.toLowerCase().endsWith(".exe"));
  if (exes.length > 0) return exes[0];

  const bats = files.filter((f) => f.toLowerCase().endsWith(".bat"));
  if (bats.length > 0) return bats[0];

  const coms = files.filter((f) => f.toLowerCase().endsWith(".com"));
  if (coms.length > 0) return coms[0];

  return null;
}

function scanGames(root, sourceName) {
  if (!existsDir(root)) return [];
  const out = [];

  function walk(current) {
    if (out.length >= maxGames) return;

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    const files = entries.filter((e) => e.isFile()).map((e) => e.name);

    for (const file of files) {
      if (out.length >= maxGames) break;
      if (!isBundleFile(file)) continue;
      const abs = path.join(current, file);
      const relFile = safeRel(root, abs);
      if (relFile === null) continue;
      const title = path.basename(file, path.extname(file)).replace(/[_-]+/g, " ");
      out.push({
        id: `${sourceName}:${relFile}`,
        source: sourceName,
        title,
        relPath: relFile,
        launchType: "bundle",
        jsdosBundle: file,
        entry: null
      });
    }

    for (const entryDir of entries) {
      if (out.length >= maxGames) return;
      if (!entryDir.isDirectory()) continue;
      const next = path.join(current, entryDir.name);
      walk(next);
    }
  }

  walk(root);
  return out;
}

function listAllGames() {
  return scanGames(exodosRoot, "eXoDOS").sort((a, b) => a.title.localeCompare(b.title));
}

app.use(express.static(STATIC_DIR));

app.get("/api/games", (_req, res) => {
  const games = listAllGames();
  res.json({
    total: games.length,
    games
  });
});

app.get("/api/launch/:source/*", (req, res) => {
  const source = req.params.source;
  const relPath = req.params[0] || "";
  const base = source === "eXoDOS" ? exodosRoot : null;

  if (!base) {
    res.status(400).json({ error: "Unknown source" });
    return;
  }

  const gameTarget = path.join(base, relPath);
  const relSafe = safeRel(base, gameTarget);
  if (relSafe === null) {
    res.status(404).json({ error: "Game path not found" });
    return;
  }

  if (fs.existsSync(gameTarget) && fs.statSync(gameTarget).isFile() && isBundleFile(gameTarget)) {
    const encodedFile = encodeURIComponent(relSafe);
    res.json({
      source,
      relPath,
      bundle: `/api/bundle/${source}/${encodedFile}`,
      entry: null
    });
    return;
  }

  if (!existsDir(gameTarget)) {
    res.status(404).json({ error: "Game path not found" });
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(gameTarget, { withFileTypes: true });
  } catch {
    res.status(500).json({ error: "Cannot read game directory" });
    return;
  }

  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const jsdosBundle = files.find((f) => f.toLowerCase().endsWith(".jsdos"));
  const entry = detectEntry(files);

  if (!jsdosBundle) {
    res.status(422).json({
      error: "No .jsdos bundle found in this game directory",
      tip: "Convert this game to .jsdos first"
    });
    return;
  }

  const bundlePath = path.join(gameTarget, jsdosBundle);
  const bundleRel = safeRel(base, bundlePath);
  const encoded = encodeURIComponent(bundleRel);

  res.json({
    source,
    relPath,
    bundle: `/api/bundle/${source}/${encoded}`,
    entry: entry || null
  });
});

app.get("/api/bundle/:source/:bundleRel", (req, res) => {
  const source = req.params.source;
  const base = source === "eXoDOS" ? exodosRoot : null;
  if (!base) {
    res.status(400).end();
    return;
  }

  const decoded = decodeURIComponent(req.params.bundleRel || "");
  const target = path.join(base, decoded);
  const relSafe = safeRel(base, target);
  if (!relSafe) {
    res.status(403).end();
    return;
  }
  res.sendFile(target);
});

app.listen(port, () => {
  console.log(`exogallery listening on :${port}`);
  console.log(`eXoDOS path: ${exodosRoot}`);
});
