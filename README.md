# WarehouseOS — Operations Dashboard

> Real-time warehouse operations control panel. Manage tasks, inventory, receiving, labor coaching, quality incidents, and shift reports — all from one browser tab.

[![Live Demo](https://img.shields.io/badge/demo-GitHub%20Pages-blue)](https://zaspdragon.github.io/warehouse-ops-app/)

## Features

| Module | What it does |
|---|---|
| **Dashboard** | Live KPI cards, task summary, supervisor notes, shift clock |
| **Operations** | Create, advance, and delete tasks with owner, zone, priority, age, and risk tracking |
| **Inventory** | Stock levels by SKU and bin, cycle count entry, status filters (Healthy / Low / Out) |
| **Receiving & Dock** | Truck log with live dock timers, container and OSD tracking, average dock time, delay flags |
| **Put-Away OCR** | Upload a label image → Tesseract.js extracts text → parsed entries saved to put-away log |
| **Labor & Coaching** | Employee productivity bars with goal status, coaching log with notes and dates |
| **Quality & Safety** | Incident tracker (near misses, damage, safety violations) with severity, area, and owner |
| **Reports** | Generate and download Supervisor, Receiving, and Inventory reports as plain-text files |
| **CSV Export** | One-click CSV export on every major table |
| **Global Search** | Instant cross-module search from the top bar |
| **Mobile** | Responsive sidebar with hamburger menu on phones and tablets |

## Tech Stack

- **Zero dependencies** — pure HTML, CSS, and vanilla JavaScript
- **Tesseract.js** (CDN) — client-side OCR for put-away label scanning
- **Google Fonts** — Inter typeface for clean typography
- **localStorage** — all data persists in the browser; "Reset Demo Data" restores defaults
- **GitHub Pages** — static deploy, no server required

## Getting Started

```bash
git clone https://github.com/ZaspDragon/warehouse-ops-app.git
cd warehouse-ops-app
# Open index.html in any browser — no build step needed
```

Or visit the live demo at [zaspdragon.github.io/warehouse-ops-app](https://zaspdragon.github.io/warehouse-ops-app/).

## File Structure

```
warehouse-ops-app/
├── index.html     # App shell — sidebar, topbar, all 7 view containers, modal, toast
├── styles.css     # Design system — variables, layout, cards, KPIs, badges, mobile, print
├── app.js         # Application logic — state, CRUD, rendering, OCR, CSV, reports
└── README.md
```

## License

MIT
