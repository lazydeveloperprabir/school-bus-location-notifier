# School Bus Location Notifier

Progressive Web App that tracks a school bus against your home location and sounds alarms when the bus is near.

## Features

- **Set home** — use device GPS or tap the map
- **GPS link** — paste a Maps/tracker link or `lat,lng`; reuse the last saved link
- **On-device storage** — home, GPS link, pickup/drop routes, and alarm points are saved in phone memory (IndexedDB + backup)
- **Route alarm points** — tap multiple spots on the saved route to get one-shot alerts
- **Live map** — OpenStreetMap tracking with **road-network** distance (OSRM)
- **Approaching alert** — continuous voice inside your home approach distance
- **Configurable announcements** — choose how often voice repeats while approaching
- **Arrival alert** — different sound when the bus arrives
- **Demo mode** — simulated bus approaching home (great for testing alerts)
- **Installable PWA** — works offline for the app shell

## Run locally

```bash
npm install
npm run dev
```

## Deploy (Vercel)

Production URL: https://school-bus-location-notifier.vercel.app

```bash
npx vercel --prod
```

Or connect this repo in the [Vercel dashboard](https://vercel.com/new) — build command `npm run build`, output `dist`.


## GPS links

Paste the same tracker or Maps URL you open in a browser. The app resolves it through a server (`/api/gps`) so browser CORS does not block reading the page.

Supported well:

- **CPARK GPS360 / Wialon locator** links like `https://gps360.cpark.in/locator/index.html?t=…`
- Google Maps URLs that include `@lat,lng` or `q=lat,lng` (including short links that redirect)
- Tracker pages / JSON APIs that embed latitude & longitude in the HTML or response
- Raw coordinates: `12.9716, 77.5946`

If a portal only injects the bus position with client-side JavaScript and never puts coordinates in the HTML or an API response, open the link in a browser, then copy the address-bar URL after the map loads (it often then contains `@lat,lng`).


## Alerts

Alarm sounds unlock automatically when you tap **Start tracking** or **Try demo**.

| Condition | Behavior |
|-----------|----------|
| ≤ configured **road** distance (default 700 m) | Approaching alarm + voice on your interval |
| ≤ arrival radius (default ~80 m) | Arrival chime + “bus has arrived” |

Distance uses OpenStreetMap road routing (OSRM). If routing is unavailable, the app falls back to straight-line distance. Alerts are distance-based only (no ETA threshold).
