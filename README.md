# Freebuff AI TH & Freebuff Manager

Windows tools for the Freebuff Desktop Thai translation and isolated app clones.

## Components

- `Freebuff Thai/` — translation runtime, dictionaries, installer, scanners, and Thai Pack builder.
- `clone-engine/` — isolated Freebuff clone management.
- `manager-app/` — Freebuff Manager 0.2.3 source and lockfile.
- `Freebuff Manager 0.2.3/` — current portable and setup executables.
- `build/` — Thai Pack v6 generated from the current translation source.
- `dev/selftest-pack.cjs` — sandbox install/uninstall selftest (53 checks).

The translation source was checked against Freebuff Desktop v0.0.147 on 2026-09-26: 1,635 strings, 286 patterns, and 9 phrases; the installed app and clones A–E are synchronized.

See [README-TH.md](README-TH.md) for user instructions and [HANDOFF.md](HANDOFF.md) for architecture and maintenance notes.

## Build the Manager

```powershell
cd manager-app
npm ci
npm run build
```

The Setup and Portable outputs are written to `manager-app/dist/`.

## Release

GitHub Actions builds the Manager and Thai Pack when a `manager-v0.2.3` style tag is pushed.
The Manager verifies downloaded update metadata, version, URL, and SHA-256 digest before applying updates.
