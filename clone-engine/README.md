# Clone engine

This is the app-cloning half of the repository. `manager-app` packages this folder into `resources/clone-engine`, alongside the Thai translation half in `Freebuff Thai/`.

- `Manage-Freebuff-Clones.ps1` clones the installed Freebuff Desktop, keeps one app-data profile per clone, and supports update/rebuild.
- The Manager invokes it with `--clone-only` and `--clone-root` so clone operations do not install or modify the Thai translation layer.
- Runtime clone records and profiles live under `%LOCALAPPDATA%\Freebuff-Clones`; the packaged installation directory stays read-only.
- Existing clone folders are discovered from `%LOCALAPPDATA%\Freebuff-Clones` and the legacy `D:\This PC\Ai\clone Freebuff` project. Updating a clone migrates its app copy to the managed root while retaining its profile folder.

The app-cloning and Thai translation modules stay separate in this repository. Freebuff Manager packages both so users can use either feature without a development checkout.
