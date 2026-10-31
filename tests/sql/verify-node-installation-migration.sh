#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must point to the disposable CI Postgres service}"

psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/verify-node-installation-migration.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261031161735_aivanta_node_installation_manager.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261031162110_aivanta_node_installation_indexes.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/verify-node-installation-migration-rls.sql
