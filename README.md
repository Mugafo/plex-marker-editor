# Plex marker editor

I had previously been doing all this manually with DB Browser for SQLite, then I found this [MarkerEditorPlex](https://github.com/danrahn/MarkerEditorForPlex) but I wanted something a little simpler for my needs and I used this as a learning exercise.

Web UI to browse your Plex libraries and edit **intro** and **credits** markers against the Plex library SQLite database (`com.plexapp.plugins.library.db`). The stack is a small **Express** API (`better-sqlite3`) and a **React** + **Vite** frontend.

**Important:** You need to stop Plex Media Server before editing the database, and probably should make a backup of the `.db` file.

## Configuration

### `PLEX_DATA_HOST_PATH`

This is the **host** directory that Docker mounts at **`/data`** inside the API container. It should contain (or be the parent of) your Plex library database file.

Use a path in the form your **host OS** expects when you run `docker compose` from:

- **Windows (Docker Desktop, PowerShell or CMD from Windows):** use a Windows path. Docker’s volume parser is picky; **prefer forward slashes** for drive letters and folders, e.g.  
  `PLEX_DATA_HOST_PATH="C:\Users\<username>\AppData\Local\Plex Media Server\Plug-in Support\Databases"`
  or a repo-relative path like `./data`.
- **Linux or WSL (where Docker is the Linux engine and paths are POSIX):** use a normal Linux path, e.g.  
  `PLEX_DATA_HOST_PATH=/home/you/plex-data`  
  or under WSL something like  
  `PLEX_DATA_HOST_PATH=/mnt/f/Databases`  
  if the files live on an `F:` drive exposed under `/mnt/f`.

### `PLEX_DB_PATH`

Path **inside the container** to the database file. It must live under the mounted `/data` tree, for example:

```env
PLEX_DB_PATH=/data/com.plexapp.plugins.library.db
```

### Ports (optional)

In `.env`:

- `WEB_HOST_PORT` — host port for the Vite dev UI (default `5174`).
- `API_HOST_PORT` — host port for the API (default `3101`).

## Run without Docker (optional)

Requires Node.js compatible with the workspaces. From the repo root:

```bash
npm install
```

Set **`PLEX_DB_PATH`** in the environment to the **full path on your machine** to `com.plexapp.plugins.library.db`, then:

```bash
npm run dev
```

The frontend dev server proxies API requests; see `frontend` / `api` package scripts for details.

## Project layout

- **`api/`** — REST API and SQLite access.
- **`frontend/`** — React SPA.
- **`docker-compose.yml`** — dev-oriented API + web services and volume mounts.
