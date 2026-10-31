#!/bin/bash
# Payaco nightly backup (D-79): full dump of schema public + readable CSV files (incl. the file list of storage).
# Installed by backup-install.sh as /usr/local/bin/payaco-backup; connection in /etc/payaco-backup/env (root only).
set -uo pipefail
set -a; . /etc/payaco-backup/env; set +a
BIN=/usr/lib/postgresql/17/bin
ROOT=/var/backups/payaco
STAMP=$(TZ=Asia/Tehran date +%Y-%m-%d_%H%M)
DIR=$ROOT/$STAMP
umask 077
mkdir -p "$DIR/csv"
fail() { local m=${1//\$/}; m=${m//\'/}; echo "$(date -Is) FAILED: $m"; "$BIN/psql" -Atqc "select public.record_backup(0, 'failed: $m')" >/dev/null 2>&1; exit 1; }

# storage internals are not readable by the backup role; the file list is kept as CSV below
if ! "$BIN/pg_dump" -Fc -n public --no-owner --no-privileges -f "$DIR/payaco.dump" 2> "$DIR/pg_dump.err"; then
  fail "pg_dump: $(head -c 150 "$DIR/pg_dump.err" | tr '\n' ' ')"
fi
rm -f "$DIR/pg_dump.err"
"$BIN/pg_restore" -l "$DIR/payaco.dump" > /dev/null || fail "dump unreadable"

# readable copies (open in Excel; UTF-8 with BOM so Persian shows correctly)
for q in \
  "contracts|select * from public.v_contract_overview order by contract_code" \
  "invoices|select i.*, c.contract_code from public.invoices i left join public.contracts c on c.id = i.contract_id order by i.id" \
  "invoice_items|select * from public.invoice_items order by invoice_id, id" \
  "ledger|select l.*, c.contract_code from public.ledger l left join public.contracts c on c.id = l.contract_id order by l.contract_id, l.transaction_date, l.id" \
  "payments|select * from public.payments order by id" \
  "service_reports|select * from public.service_reports order by id" \
  "faults|select * from public.faults order by id" \
  "repairs|select * from public.repairs order by id" \
  "buildings|select * from public.buildings order by id" \
  "customers|select * from public.customers order by id" \
  "elevators|select * from public.elevators order by contract_id, elevator_no" \
  "users|select id, full_name, username, role, is_active from public.user_profiles order by full_name" \
  "storage_files|select bucket_id, name, metadata->>'size' as size, created_at from storage.objects order by bucket_id, name"; do
  name=${q%%|*}; sql=${q#*|}
  { printf '\xEF\xBB\xBF'; "$BIN/psql" -Atqc "copy ($sql) to stdout with (format csv, header)"; } > "$DIR/csv/$name.csv" || fail "csv $name"
done

BYTES=$(du -sb "$DIR" | cut -f1)
# keep 7 days, and the first backup of each month for one year (D-79)
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +7 ! -name '*-01_*' -exec rm -rf {} +
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +366 -exec rm -rf {} +
"$BIN/psql" -Atqc "select public.record_backup($BYTES, 'ok')" >/dev/null || echo "$(date -Is) warning: could not record the backup time"
echo "$(date -Is) OK $DIR ($BYTES bytes)"
