-- Users and identities are separate so more sign-in providers can be added later.
CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT,
    email TEXT,
    mass_unit TEXT CHECK (mass_unit IS NULL OR mass_unit IN ('kg', 'lb')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE auth_identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX auth_identities_by_user ON auth_identities(user_id);

-- One row per refresh token. Rotation creates a new row in the same family; presenting an
-- already-rotated token revokes the whole family (likely theft).
CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL,
    refresh_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rotated_at TEXT,
    revoked_at TEXT,
    client TEXT NOT NULL CHECK (client IN ('web', 'ios', 'dev'))
);
CREATE INDEX auth_sessions_by_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_by_family ON auth_sessions(family_id);

-- Short-lived OAuth state between /start and /callback.
CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY NOT NULL,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'ios')),
    app_challenge TEXT NOT NULL,
    -- Where to send the one-time code: setbook://auth for iOS, an allowed web URL otherwise.
    return_to TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- One-time codes handed back to the app (URL scheme on iOS, return URL on the web),
-- redeemable only with the PKCE verifier the app generated, so an intercepted redirect is useless.
CREATE TABLE login_codes (
    code_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_challenge TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);

-- User records stored as validated JSON documents. The primary key includes user_id, so
-- one user's ID can never address another user's record.
CREATE TABLE records (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity TEXT NOT NULL CHECK (entity IN ('exercise', 'template', 'session', 'measurement')),
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    deleted INTEGER NOT NULL DEFAULT 0,
    body TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, entity, id)
);
CREATE INDEX records_by_user_entity ON records(user_id, entity, deleted);

-- Ordered change cursor for pull.
CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL
);
CREATE INDEX changes_by_user_seq ON changes(user_id, seq);

-- Idempotency: the stored result of each applied mutation.
CREATE TABLE mutations (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mutation_id TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, mutation_id)
);

-- Inserting NULL here fails the NOT NULL constraint, which aborts the whole D1 batch.
-- Used as an optimistic-concurrency guard because D1 has no interactive transactions.
CREATE TABLE revision_guard (
    must_not_be_null INTEGER NOT NULL
);
