# Receiving Production Dashboard

The dashboard is available at `production.html`.

## Read protection

- No Firestore snapshot listeners.
- No interval polling.
- Data loads only when the page opens, the date is refreshed, or a truck record is saved.
- Queries are tenant-scoped and capped.
- Only the selected work date is rendered.
- Truck unloads are stored as one `activityLogs` document per truck, not one document per pallet.

## Metrics

- Putaways completed against an editable daily goal of 45.
- Trucks unloaded.
- Total and average pallets per truck.
- Pallets per unloading hour.
- Employee-level putaway and truck production.
- Truck number, type, time, problems, and notes.

The existing putaway form and history processes are not modified by this feature.
