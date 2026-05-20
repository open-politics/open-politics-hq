-- Seed fixture for the 5M-annotation scale test (Phase 4.8).
--
-- Generates a single infospace with 5M annotations across 100 runs, 500
-- schemas, 50 bundles. Each annotation's ``value`` has populated
-- ``triplets`` so ``AnnotationQuery.graph_stream("triplets")`` has work
-- to do.
--
-- Run once (CI matrix job) and keep the result in a throwaway test database.
-- Takes ~2-5 minutes on a local Postgres. Restore into the fixture DB used
-- by the scale marker.
--
-- Usage:
--   docker compose exec -T db psql -U postgres -d test_scale < seed_5m_annotations.sql

BEGIN;

-- User + infospace
INSERT INTO "user" (email, hashed_password, is_active, is_superuser, email_verified, full_name, created_at, updated_at)
VALUES ('scale@test.local', 'x', true, true, true, 'scale', now(), now())
ON CONFLICT (email) DO NOTHING
RETURNING id \gset user_

INSERT INTO infospace (name, owner_id, uuid, created_at)
VALUES ('scale-5m', :user_id, gen_random_uuid()::text, now())
RETURNING id \gset iid_

-- 50 bundles
INSERT INTO bundle (name, infospace_id, user_id, parent_bundle_id, sealed, asset_count, child_bundle_count, version, uuid, tags, created_at, updated_at)
SELECT
  'bundle-' || g,
  :iid_id,
  :user_id,
  0,
  false,
  0,
  0,
  '1.0',
  gen_random_uuid()::text,
  '[]'::json,
  now(),
  now()
FROM generate_series(1, 50) AS g;

-- 500 schemas
INSERT INTO annotationschema (name, description, output_contract, instructions, infospace_id, user_id, version, is_active, uuid, created_at, updated_at)
SELECT
  'schema-' || g,
  'seed',
  '{"type":"object"}'::jsonb,
  'seed',
  :iid_id,
  :user_id,
  '1.0',
  true,
  gen_random_uuid()::text,
  now(),
  now()
FROM generate_series(1, 500) AS g;

-- 100 runs
INSERT INTO annotationrun (name, description, configuration, infospace_id, user_id, status, uuid, created_at, updated_at, include_parent_context, context_window, trigger_type, run_type, follow_on_version_change)
SELECT
  'run-' || g,
  'seed',
  '{}'::jsonb,
  :iid_id,
  :user_id,
  'COMPLETED',
  gen_random_uuid()::text,
  now(),
  now(),
  false,
  0,
  'MANUAL',
  'ONE_OFF',
  false
FROM generate_series(1, 100) AS g;

-- One asset per bundle
INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, uuid, processing_status, stub, created_at, updated_at)
SELECT
  'asset-' || g,
  'ARTICLE',
  :iid_id,
  :user_id,
  ARRAY[b.id]::int[],
  gen_random_uuid()::text,
  'READY',
  false,
  now(),
  now()
FROM bundle b WHERE b.infospace_id = :iid_id;

-- 5M annotations: round-robin across runs/schemas/assets, triplet arrays
-- populated with a deterministic but varied pattern.
INSERT INTO annotation (run_id, schema_id, asset_id, value, status, infospace_id, user_id, timestamp, uuid, created_at, updated_at)
SELECT
  (SELECT id FROM annotationrun WHERE infospace_id = :iid_id ORDER BY id LIMIT 1 OFFSET (g % 100)),
  (SELECT id FROM annotationschema WHERE infospace_id = :iid_id ORDER BY id LIMIT 1 OFFSET (g % 500)),
  (SELECT id FROM asset WHERE infospace_id = :iid_id ORDER BY id LIMIT 1 OFFSET (g % 50)),
  jsonb_build_object(
    'sentiment', CASE (g % 3) WHEN 0 THEN 'positive' WHEN 1 THEN 'negative' ELSE 'neutral' END,
    'triplets', jsonb_build_array(
      jsonb_build_object(
        'subject_name', 'S' || (g % 1000),
        'subject_type', 'person',
        'predicate',    CASE (g % 4) WHEN 0 THEN 'knows' WHEN 1 THEN 'meets' WHEN 2 THEN 'cites' ELSE 'says' END,
        'object_name',  'O' || (g % 1000),
        'object_type',  'org'
      )
    )
  ),
  'SUCCESS',
  :iid_id,
  :user_id,
  now(),
  gen_random_uuid()::text,
  now(),
  now()
FROM generate_series(1, 5000000) AS g;

COMMIT;

VACUUM ANALYZE annotation;
