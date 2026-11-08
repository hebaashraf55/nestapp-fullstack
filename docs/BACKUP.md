# Backups and restore

NOMA keeps everything in one MongoDB database: accounts, the catalogue, carts, orders, reviews,
promotions, inventory history, notifications and jobs. Back that database up; nothing else is stateful
(product photos are files in the repository).

> **Never restore over a database you have not backed up first, and never test a restore against the
> live database.** Restore into a separate database name, check it, and only then switch.

## What to expect from each environment

| Where | Automatic backups | What to do |
|---|---|---|
| Local Docker (`npm run db:up`) | None | `npm run db:backup` before risky work |
| MongoDB Atlas **M0 (free)** | **None** (Atlas backups need a paid tier) | Run `mongodump` on a schedule (below) |
| Atlas M10+ (paid) | Continuous cloud backups | Use the Atlas UI; keep a monthly `mongodump` as a second copy |

## Make a backup

`tools/backup.sh` runs `mongodump` with the connection string from `MONGODB_URI` (read from `.env` when
present) and writes a compressed archive to `backups/` (git-ignored):

```bash
npm run db:backup
# → backups/noma-2026-11-08T09-30-00Z.archive.gz
```

It never prints the connection string, only reads, and fails loudly if `mongodump` is missing
(install the MongoDB Database Tools: `brew install mongodb-database-tools`).

For Atlas M0, run it from a machine you control (or a scheduled CI job with the URI in a repository
secret) daily, and keep at least 7 daily and 4 weekly archives somewhere other than the database host.

## Restore (into a separate database first)

```bash
# 1. Restore the archive under a new name, leaving the original untouched
mongorestore --uri="$MONGODB_URI" --gzip --archive=backups/noma-….archive.gz \
  --nsFrom='noma.*' --nsTo='noma_restore_check.*'

# 2. Check it: counts should match what you expect
mongosh "$MONGODB_URI" --eval 'const d = db.getSiblingDB("noma_restore_check");
  ["users","products","orders","coupons","reviews"].forEach(c => print(c, d[c].countDocuments()))'

# 3. Point a local API at the restored copy and run the read-only checks
MONGODB_URI=…/noma_restore_check npm run start:dev   # then GET /api/health/ready and browse

# 4. Only then, if you really mean to replace production: stop the API, restore with --drop into the
#    real name, start the API, and watch /api/health/ready.
```

Replace `noma` with your database name (local Docker uses `nestapp`).

## Restore drill

Once a quarter (or before a big change): make a backup, restore it into `noma_restore_check`, run the
counts, browse a few orders, then drop the check database. A backup that has never been restored is
not a backup.

## What is not in the database

- Product photos and credits: in `web/public/catalogue` (the repository).
- Secrets: in Render's environment settings and your password manager, never in backups or git.
- Logs: written to standard output and kept by the host (Render keeps recent logs on the free plan).
