# OTH production deployment

Verified September 14, 2026: **oth.surf runs on the Raspberry Pi, not Render.**
The Render configuration in this repository is historical. Pushing GitHub does
not publish changes to the Pi.

## Source of truth

- Host: `ai-orchestrator-pi` (Tailscale `100.85.194.105`).
- Production source: `/opt/ai-home/render-services/oth` (not a Git checkout).
- Compose file: `/opt/ai-home/docker-compose.apps.yml`.
- Dockerfile: `Dockerfile.ai-home`, Node 20 Alpine.
- Main service/container: `oth` / `app-oth`, host port 4101 to container 3000.
- Relays: `oth-surfline-relay` and `oth-surfline-relay-public`.
- Persistent forecast snapshots/history: `/opt/ai-home/data/oth` mounted at `/app/data`.
- Caddy routes `oth.surf` and `www.oth.surf` to `app-oth:3000`.

Always inspect the Pi source, running container, and differences before changing
production. Do not overwrite the Pi with this checkout: the Pi has independent
changes, including snapshot history. Preserve its configuration and persistent data.

## September 14 repair

Both relays retained wave data fetched September 3 (forecast ended September 9),
but reported the newest wind/tide fetch time as the snapshot timestamp. The main
app accepted these expired rows, masking all current forecasts. Stormglass was
not configured in the production container; the existing Open-Meteo adapter was
not wired into the server and interpreted Pacific timestamps as host-local time.

The targeted repair reconnects Open-Meteo, rejects expired rows, corrects relay
freshness and timestamp handling, compares upcoming daytime slots, and displays
relative swell push. Tests are included in the Pi source under `test/`.

The separate `app-oth-surf-scraper` uses static sample JSON and is not the public
site's data source under the inspected Caddy routes. It was not changed.

## Build and verify

Back up the Pi source and tag the running images before changes. Apply a reviewed
patch to the Pi source, then build only the three OTH services:

```sh
docker compose -f /opt/ai-home/docker-compose.apps.yml build oth oth-surfline-relay oth-surfline-relay-public
docker run --rm --network none ai-home-apps-oth node --test
docker compose -f /opt/ai-home/docker-compose.apps.yml up -d --no-deps oth oth-surfline-relay oth-surfline-relay-public
```

Verify `https://oth.surf/api/forecast/bolinas` has current forecast timestamps,
accurate source labels and usable tides; verify the public dashboard and day navigation.
A healthy process alone does not establish that forecast data is current.

September 14 rollback assets on the Pi:

- `/opt/ai-home/backups/oth-code-20260914/source-before-repair.tar.gz`
- `oth-rollback:20260914`
- `oth-relay-rollback:20260914`
- `oth-relay-public-rollback:20260914`
