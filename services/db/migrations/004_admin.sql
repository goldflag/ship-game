-- Better Auth admin plugin fields, and an append-only record of what administrators
-- changed in a player's research. Promote an account with
-- UPDATE auth."user" SET role='admin' WHERE email='…' (see docs/accounts.md).
ALTER TABLE auth."user" ADD COLUMN role text, ADD COLUMN banned boolean DEFAULT false,
 ADD COLUMN "banReason" text, ADD COLUMN "banExpires" timestamptz;
ALTER TABLE auth.session ADD COLUMN "impersonatedBy" text;
CREATE TABLE progress.admin_actions (
 id bigserial PRIMARY KEY, owner_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 admin_id text NOT NULL, action jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON progress.admin_actions (owner_id, created_at);
GRANT SELECT, INSERT ON progress.admin_actions TO ships_api;
GRANT USAGE ON SEQUENCE progress.admin_actions_id_seq TO ships_api;
