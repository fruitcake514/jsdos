# eXoDOS Gallery (Docker Compose)

Web UI that scans an `eXoDOS` folder, builds a searchable game gallery, and launches supported titles in-browser with one click using `js-dos`.

## What it does

- Scans mounted eXoDOS library directories recursively
- Creates a gallery with search + one-click Play buttons
- Shows only `.jsdos` bundles in the gallery
- Launches `.jsdos` bundles directly with js-dos

## Folder layout expected

Create local mounts like this:

```text
./data/
  exodos/
    <game directories>
```

Each game directory should ideally include a `.jsdos` bundle with `.jsdos/dosbox.conf` inside.

## Run

```bash
docker compose up --build
```

Open:

`http://localhost:8080`

## Notes on eXoDOS compatibility

- Raw eXoDOS installs often need wrappers or launch scripts that are not browser-native.
- For true one-click browser launch, convert titles to `.jsdos` bundles first.
- This app detects `.jsdos` automatically once placed in each game folder.

## Fast zip -> jsdos conversion

Use the included converter to wrap existing game zips with the required `.jsdos/dosbox.conf`:

```bash
python3 scripts/convert_to_jsdos.py --input data/exodos
```

Optional output directory:

```bash
python3 scripts/convert_to_jsdos.py --input data/exodos --output data/exodos_jsdos
```

What it does:

- Copies each `.zip` into a new `.jsdos` file (zip format)
- Adds `.jsdos/dosbox.conf` (required by js-dos v7)
- If a `dosbox.conf` is present inside a game zip, uses its `[autoexec]` hints (`cd`, `imgmount`, `path`, `set`)
- Auto-detects startup command from common `.bat/.exe/.com` files while downranking setup/config utilities
- If zip contains one top-level folder, autoexec `cd`s into it before launching

For best results, validate a few bundles and adjust launch command manually in `.jsdos/dosbox.conf` when needed.

## Environment variables

- `PORT` (default `8080`)
- `EXODOS_PATH` (default `/library/exodos`)
- `MAX_GAMES` (default `5000`)
