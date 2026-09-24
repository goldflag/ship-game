-- Research progress: one profile per account and an append-only record of paid
-- battles. A battle id pays once; the stored award answers retries.
CREATE SCHEMA progress;
CREATE TABLE progress.profiles (
 owner_id text PRIMARY KEY REFERENCES auth."user"(id) ON DELETE CASCADE,
 profile jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE progress.awards (
 owner_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE, id uuid NOT NULL,
 digest text NOT NULL, award jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,id)
);
GRANT USAGE ON SCHEMA progress TO ships_api;
GRANT SELECT, INSERT, UPDATE ON progress.profiles TO ships_api;
GRANT SELECT, INSERT ON progress.awards TO ships_api;
