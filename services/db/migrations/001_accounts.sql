CREATE SCHEMA auth;
CREATE SCHEMA ships;
CREATE SCHEMA results;
CREATE TABLE auth."user" (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 "emailVerified" boolean NOT NULL DEFAULT false, image text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth.session (
 id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL,
 "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE
);
CREATE INDEX ON auth.session ("userId");
CREATE TABLE auth.account (
 id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
 "userId" text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text,
 "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
 scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL
);
CREATE INDEX ON auth.account ("userId");
CREATE TABLE auth.verification (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
 "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth.verification (identifier);
CREATE TABLE ships.designs (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES auth."user"(id),
 client_key text NOT NULL, name text NOT NULL, revision_id uuid, updated_at bigint NOT NULL,
 UNIQUE(owner_id,client_key)
);
CREATE TABLE ships.revisions (
 id uuid PRIMARY KEY, design_id uuid NOT NULL REFERENCES ships.designs(id) ON DELETE CASCADE,
 parent_id uuid, created_at bigint NOT NULL, schema_version integer NOT NULL,
 catalog_revision text NOT NULL, source_json text NOT NULL, source_id text NOT NULL,
 bytes integer NOT NULL CHECK(bytes > 0)
);
CREATE INDEX ON ships.revisions (design_id);
CREATE TABLE ships.operations (
 owner_id text NOT NULL REFERENCES auth."user"(id), id uuid NOT NULL,
 digest text NOT NULL, response jsonb NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE TABLE results.matches (
 id text PRIMARY KEY, record jsonb NOT NULL, finished boolean NOT NULL DEFAULT false,
 account_a text, account_b text
);
CREATE FUNCTION results.immutable_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.finished THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_terminal BEFORE UPDATE ON results.matches FOR EACH ROW EXECUTE FUNCTION results.immutable_terminal();
GRANT USAGE ON SCHEMA auth, ships TO ships_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, ships TO ships_api;
GRANT USAGE ON SCHEMA results TO ships_battle;
GRANT SELECT, INSERT, UPDATE ON results.matches TO ships_battle;
