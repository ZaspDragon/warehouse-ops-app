# Warehouse Ops App

A static warehouse operations dashboard — built with vanilla HTML, CSS, and JavaScript. Deployable on GitHub Pages with zero build step.

## Live Demo

[https://zaspdragon.github.io/warehouse-ops-app/](https://zaspdragon.github.io/warehouse-ops-app/)

## Features

- **Dashboard** — Shift overview with open tasks, trucks, cycle counts, low inventory, active timers, and labor issues
- **Operations** — Task CRUD with age tracking, risk detection, and status advancement (Active → Queued → Pending → Done)
- **Inventory** — Stock levels by SKU with filtering (status, bin), cycle count logging, and variance tracking
- **Receiving & Dock** — Truck check-in with live elapsed timers, delay detection (>60 min), container/OS&D tracking
- **Put-Away OCR** — Upload label images and parse put-away entries using Tesseract.js OCR
- **Labor & Coaching** — Employee productivity tracking, coaching log with notes
- **Quality & Safety** — Incident reporting (near miss, damage, variance) with severity and area tracking
- **Reports** — Generate and download supervisor, receiving, and inventory reports as text files
- **Global Search** — Search across all modules simultaneously
- **Persistent Storage** — All data saved to localStorage

## Files

- `index.html` — App shell with sidebar navigation and all view layouts
- `app.js` — Application logic, CRUD operations, rendering, and localStorage persistence
- `styles.css` — Responsive styling with sidebar layout and mobile breakpoints

## How to Deploy

1. Create a new GitHub repository
2. Upload all files to the root
3. In repo Settings → Pages, deploy from `main` branch root
4. Visit `https://<username>.github.io/<repo-name>/`
