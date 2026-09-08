# Backup and Restore

The production deployment stores MySQL data in `./data/database`, application
data in `./data`, uploads in `./uploads`, and generated archives in `./backups`.
The database is not published to the host or internet.

## Create a backup

1. Make sure `.env` exists and contains the database credentials used by
   `docker-compose.yml`.
2. Start the stack so the database is available:

   ```bash
   docker compose up -d
   ```

3. Create an archive:

   ```bash
   ./scripts/backup.sh
   ```

The result is `backups/backup-<UTC timestamp>.tar.gz`. It contains:

- `database.sql`, a transaction-consistent MySQL dump
- `data/`, excluding the live MySQL bind mount because `database.sql` is the
   consistent database backup
- `uploads/`, including user-uploaded media
- `config/`, containing deployment files and non-secret environment examples

Do not place `.env` or API keys in the archive. Store production secrets in a
separate password manager or secret store and recreate them on the destination.

## Restore on the same server

Stop the application before restoring files:

```bash
docker compose down
tar -xzf backups/backup-YYYY-MM-DDTHH-MM-SSZ.tar.gz -C /tmp/cefr-restore
cp -a /tmp/cefr-restore/data/. data/
cp -a /tmp/cefr-restore/uploads/. uploads/
docker compose up -d database
```

Restore the logical database dump after MySQL is healthy:

```bash
docker compose exec -T database sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
  < /tmp/cefr-restore/database.sql
docker compose up -d
```

The API runs `npm run migrate` on startup. The migration is idempotent and can
be run again after restoring an older archive:

```bash
docker compose run --rm api npm run migrate
```

## Migrate to another server

1. Install Docker Engine and the Compose plugin on Server B.
2. Copy the repository and a backup archive to Server B.
3. Create `.env` from `.env.example`; use the same `JWT_SECRET` if existing
   users must keep their active tokens, and set new database passwords if
   desired.
4. Extract the archive as described above, restore `database.sql`, and run
   `docker compose up -d`.
5. Put Caddy, Nginx Proxy Manager, Traefik, or another TLS terminator in front
   of port `8080`. Set `CORS_ORIGIN` to the public web origin.
6. Verify `https://your-host/health`, web login, and mobile login using
   `EXPO_PUBLIC_API_URL=https://your-host/api/v1`.

Never expose port `3306` or the API port directly. Only the web/reverse-proxy
port should be reachable from outside the Docker host.

## Migration process

Schema changes belong in `backend/src/db/schema.sql`. The startup command runs
the migration before starting the API, and each schema statement is applied
individually so existing tables and indexes do not prevent later statements
from running. Test a migration against a copy of `data/database` before
deploying it to a production host.