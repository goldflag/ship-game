#!/bin/sh
set -eu
# Executed once by the PostgreSQL image. Secrets enter psql variables, never SQL interpolation.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v api_password="$API_DB_PASSWORD" -v battle_password="$BATTLE_DB_PASSWORD" -v migration_password="$MIGRATION_DB_PASSWORD" <<'SQL'
CREATE ROLE ships_api LOGIN PASSWORD :'api_password';
CREATE ROLE ships_battle LOGIN PASSWORD :'battle_password';
CREATE ROLE ships_migration LOGIN PASSWORD :'migration_password';
GRANT CREATE ON DATABASE ships TO ships_migration;
GRANT USAGE, CREATE ON SCHEMA public TO ships_migration;
GRANT ships_api TO ships_migration;
ALTER ROLE ships_api SET search_path = auth;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
