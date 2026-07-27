# WarehouseOS Repository Health Audit — 2026-07-17

## Scope

Read-only review of the current `main` branch, focused on Put Away entry, History, Item History, tenant isolation, Firebase usage, and worker/admin usability.

No production data was read, changed, migrated, merged, or deleted during this audit.

## Current safe findings

### 1. History filtering can trigger thousands of Firestore reads

`installHistoryControls()` reloads history before applying a filter. That calls `loadHistoryCollections()`, which loads both `putAwayLogs` and `activityLogs`.

Each tenant collection load currently performs two separate queries:

- `ownerEmail == current user`, limit 1,000
- `createdByEmail == current user`, limit 1,000

This means one click of **Search / Filter** can request up to approximately 4,000 documents before filtering locally. The same broad history load also occurs during sign-in.

This is a performance and Firebase-quota risk. It can also make the filter appear broken or delayed on mobile connections because the UI waits for remote reads before rerendering.

### 2. Filter behavior is split across multiple layers

Put Away History filtering is implemented in `history-upgrade.js`, while the base application also contains separate recent-log filtering and rendering logic in `app.js`.

The current History button is selected by a class rather than a unique ID. This is not automatically wrong, but it makes duplicate listener installation and future UI changes harder to reason about.

Recommended safe follow-up:

- Give the History Search, Clear, and Export controls unique IDs.
- Apply filters immediately against already-loaded bounded data.
- Add a separate explicit **Refresh Data** action for remote reloads.
- Disable the search button and show a loading message only when a remote refresh is intentionally requested.
- Keep start and end dates inclusive using local `YYYY-MM-DD` values.

### 3. Put Away has already been restored to 25-line grouped entry

The current UI says `0 / 25` and provides **Save All Lines**. The table builder and save flow should still be manually regression-tested after every history or compatibility change.

The page heading still says **Putaway Log - One Line**, which conflicts with the actual 25-line workflow and can confuse workers.

Recommended safe follow-up:

- Rename the heading to **Putaway Log — Up to 25 Lines**.
- Confirm one save creates one grouped `putAwayLogs` submission rather than one document per displayed line.
- Confirm repeated clicking cannot create duplicate submissions.

### 4. Startup still eagerly loads history

The tenant load patch loads employees, putaway history, and activity history together during sign-in.

Recommended safe follow-up:

- Load employees at sign-in because the Put Away screen needs worker choices.
- Lazy-load History and Item History only when those tabs are opened.
- Cache the result for the session and invalidate it after a successful save/edit.
- Use bounded date-range queries and pagination instead of two 1,000-document compatibility queries forever.

### 5. Activity data duplicates putaway line information

Item History combines `activityLogs` and flattened `putAwayLogs[].lines`, then deduplicates in memory.

This provides backward compatibility, but new grouped Put Away submissions should not need a second activity document for every line. Continuing both systems increases writes, reads, and duplicate-handling complexity.

Recommended safe follow-up:

- Preserve old `activityLogs` as read-only historical evidence.
- Derive new Put Away item history from grouped `putAwayLogs[].lines`.
- If an activity record is still required, create at most one summary record per submission.

## Data-safety requirements for future fixes

Any implementation PR must:

- Use a separate branch and remain draft until manually tested.
- Never delete or rewrite existing `putAwayLogs`, `activityLogs`, employees, users, or historical records.
- Never rename Firestore collections.
- Keep legacy one-line and grouped records readable.
- Avoid destructive migrations.
- Preserve tenant isolation by owner/company/branch fields.
- Include rollback instructions.

## Suggested implementation order

1. Correct the misleading one-line heading.
2. Make History filters local and immediate; separate filtering from remote refresh.
3. Add loading/empty/error states.
4. Lazy-load History and Item History by tab.
5. Add bounded date queries and pagination.
6. Stop new per-line Put Away activity duplication after compatibility tests.

## Validation required before merging any behavior change

- `node --check app.js`
- `node --check history-upgrade.js`
- `git diff --check`
- Verify no duplicate HTML IDs.
- Verify no new delete or migration path.
- Save 1, 10, and 25 lines in demo/staging mode.
- Confirm exactly one grouped submission per save.
- Test inclusive start/end dates.
- Test employee, item, putaway number, and status together.
- Confirm Clear Filter restores the correct set.
- Confirm CSV export matches visible filtered rows.
- Test mobile worker entry and manager History navigation.
- Confirm old one-line and grouped history still display.

## Changes made by this audit PR

Documentation only.

No application code, Firestore rules, schemas, users, employees, saved putaways, logs, or production behavior were changed.
