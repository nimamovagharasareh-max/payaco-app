#!/bin/bash
# Payaco nightly backup on the company server (D-79).
# Run once on the server as root:   curl -fsSL https://app.payaco.org/tools/backup-install.sh | sudo bash
# Asks for the password of the read-only database role payaco_backup (set by the CEO in Supabase), then:
#  - installs the PostgreSQL 17 client,
#  - stores the connection in /etc/payaco-backup/ (root only),
#  - installs /usr/local/bin/payaco-backup and a nightly cron job (00:00 UTC = 03:30 Tehran),
#  - runs the first backup immediately.
# Backups: /var/backups/payaco/<date>/ (full dump + readable CSV files). Kept: 7 days + the first of every month for a year.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
REF=whwsxctalcukmbawakre
CONF=/etc/payaco-backup
TTY=/dev/tty

echo "== Payaco backup installer =="
if ! command -v apt-get >/dev/null; then echo "This installer supports Debian/Ubuntu (apt) only."; exit 1; fi

if ! /usr/lib/postgresql/17/bin/pg_dump --version >/dev/null 2>&1; then
  echo "-- installing PostgreSQL 17 client"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql-client-17 >/dev/null
fi
/usr/lib/postgresql/17/bin/pg_dump --version

printf "Password of database role payaco_backup: " > $TTY
stty -echo < $TTY; read -r PW < $TTY; stty echo < $TTY; echo > $TTY
[ -n "$PW" ] || { echo "Empty password."; exit 1; }

install -d -m 700 $CONF
HOST=""
for h in aws-0-ap-northeast-1.pooler.supabase.com aws-1-ap-northeast-1.pooler.supabase.com; do
  if PGPASSWORD="$PW" PGCONNECT_TIMEOUT=20 /usr/lib/postgresql/17/bin/psql "host=$h port=5432 dbname=postgres user=payaco_backup.$REF sslmode=require" -Atc "select 1" >/dev/null 2>&1; then HOST=$h; break; fi
done
[ -n "$HOST" ] || { echo "Could not connect to the database. Check the password and the server's internet access."; exit 1; }
echo "-- connected through $HOST"
umask 077
echo "$HOST:5432:postgres:payaco_backup.$REF:$PW" > $CONF/pgpass
cat > $CONF/env <<ENV
PGHOST=$HOST
PGPORT=5432
PGDATABASE=postgres
PGUSER=payaco_backup.$REF
PGSSLMODE=require
PGPASSFILE=$CONF/pgpass
ENV
chmod 600 $CONF/pgpass $CONF/env

curl -fsSL https://app.payaco.org/tools/payaco-backup.sh -o /usr/local/bin/payaco-backup
chmod 700 /usr/local/bin/payaco-backup
echo "0 0 * * * root /usr/local/bin/payaco-backup >> /var/log/payaco-backup.log 2>&1" > /etc/cron.d/payaco-backup
chmod 644 /etc/cron.d/payaco-backup

echo "-- first backup now"
/usr/local/bin/payaco-backup | tee -a /var/log/payaco-backup.log
echo "== done. Backups are in /var/backups/payaco =="
