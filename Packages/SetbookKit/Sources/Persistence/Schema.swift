import GRDB

extension AppDatabase {
    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        #if DEBUG
        migrator.eraseDatabaseOnSchemaChange = false
        #endif

        migrator.registerMigration("v1") { db in
            try db.execute(sql: """
                CREATE TABLE exercise (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    primary_muscle TEXT NOT NULL,
                    secondary_muscles TEXT NOT NULL DEFAULT '',
                    equipment TEXT NOT NULL,
                    measurement_type TEXT NOT NULL,
                    load_convention TEXT,
                    is_built_in INTEGER NOT NULL,
                    archived_at DATETIME,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                );

                CREATE TABLE workout_template (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    notes TEXT,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    position INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                );

                CREATE TABLE template_exercise (
                    id TEXT PRIMARY KEY NOT NULL,
                    template_id TEXT NOT NULL REFERENCES workout_template(id) ON DELETE CASCADE,
                    exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE RESTRICT,
                    position INTEGER NOT NULL,
                    notes TEXT,
                    rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds > 0)
                );
                CREATE INDEX template_exercise_by_template ON template_exercise(template_id, position);
                CREATE INDEX template_exercise_by_exercise ON template_exercise(exercise_id);

                CREATE TABLE template_set (
                    id TEXT PRIMARY KEY NOT NULL,
                    template_exercise_id TEXT NOT NULL REFERENCES template_exercise(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    set_type TEXT NOT NULL,
                    target_reps_min INTEGER,
                    target_reps_max INTEGER,
                    target_load_value REAL,
                    target_load_unit TEXT,
                    CHECK (target_reps_min IS NULL OR (target_reps_min >= 1 AND target_reps_max >= target_reps_min)),
                    CHECK (target_load_value IS NULL OR target_load_value >= 0)
                );
                CREATE INDEX template_set_by_exercise ON template_set(template_exercise_id, position);

                -- source_template_id is deliberately not a foreign key: deleting a template
                -- must leave historical sessions and their source reference intact.
                CREATE TABLE workout_session (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    state TEXT NOT NULL,
                    source_template_id TEXT,
                    source_template_revision INTEGER,
                    started_at DATETIME NOT NULL,
                    finished_at DATETIME,
                    time_zone TEXT NOT NULL,
                    notes TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                );
                CREATE UNIQUE INDEX one_active_session ON workout_session(state) WHERE state = 'active';
                CREATE INDEX session_by_start ON workout_session(state, started_at);
                CREATE INDEX session_by_template ON workout_session(source_template_id, started_at);

                CREATE TABLE workout_exercise (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
                    exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE RESTRICT,
                    position INTEGER NOT NULL,
                    exercise_name TEXT NOT NULL,
                    measurement_type TEXT NOT NULL,
                    load_convention TEXT,
                    notes TEXT,
                    rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds > 0)
                );
                CREATE INDEX workout_exercise_by_session ON workout_exercise(session_id, position);
                CREATE INDEX workout_exercise_by_exercise ON workout_exercise(exercise_id);

                CREATE TABLE workout_set (
                    id TEXT PRIMARY KEY NOT NULL,
                    workout_exercise_id TEXT NOT NULL REFERENCES workout_exercise(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    set_type TEXT NOT NULL,
                    target_reps_min INTEGER,
                    target_reps_max INTEGER,
                    target_load_value REAL,
                    target_load_unit TEXT,
                    load_value REAL,
                    load_unit TEXT,
                    reps INTEGER,
                    completed_at DATETIME,
                    rir INTEGER,
                    CHECK (load_value IS NULL OR load_value >= 0),
                    CHECK (completed_at IS NULL OR reps >= 1),
                    CHECK (rir IS NULL OR rir >= 0)
                );
                CREATE INDEX workout_set_by_exercise ON workout_set(workout_exercise_id, position);

                CREATE TABLE body_measurement (
                    id TEXT PRIMARY KEY NOT NULL,
                    kind TEXT NOT NULL,
                    value REAL NOT NULL CHECK (value > 0),
                    unit TEXT NOT NULL,
                    measured_at DATETIME NOT NULL,
                    time_zone TEXT NOT NULL,
                    source TEXT NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                );
                CREATE INDEX body_measurement_by_time ON body_measurement(kind, measured_at);

                -- Reserved for future goal-aware analysis. No UI writes here in version one.
                CREATE TABLE training_goal (
                    id TEXT PRIMARY KEY NOT NULL,
                    kind TEXT NOT NULL,
                    target REAL NOT NULL,
                    unit TEXT,
                    exercise_id TEXT REFERENCES exercise(id) ON DELETE RESTRICT,
                    starts_on DATETIME NOT NULL,
                    ends_on DATETIME
                );
                """)
        }

        // Sync bookkeeping. Every local change to a syncable record queues its aggregate root
        // via triggers, so no write path can forget to sync. Pulled changes set
        // sync_flags.applying = 1 so they are not echoed back.
        migrator.registerMigration("v2-sync") { db in
            try db.execute(sql: """
                CREATE TABLE sync_flags (applying INTEGER NOT NULL);
                INSERT INTO sync_flags (applying) VALUES (0);

                CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);

                -- One row per pending write. payload stays NULL until the first send attempt,
                -- then is frozen with its mutation_id so retries are byte-identical.
                CREATE TABLE outbox (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    mutation_id TEXT,
                    payload TEXT,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX outbox_by_entity ON outbox(entity, entity_id, seq);

                -- The server revision each local record was last in step with.
                CREATE TABLE record_revision (
                    entity TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    PRIMARY KEY (entity, entity_id)
                );

                -- Writes the server refused because both sides changed. Kept until the user chooses.
                CREATE TABLE sync_conflict (
                    entity TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    message TEXT,
                    server_revision INTEGER,
                    server_deleted INTEGER NOT NULL DEFAULT 0,
                    server_body TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (entity, entity_id)
                );

                CREATE TRIGGER sync_exercise_insert AFTER INSERT ON exercise
                WHEN (SELECT applying FROM sync_flags) = 0 AND NEW.is_built_in = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'exercise', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'exercise' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_insert AFTER INSERT ON workout_template
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_exercise_insert AFTER INSERT ON template_exercise
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.template_id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_set_insert AFTER INSERT ON template_set
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT (SELECT template_id FROM template_exercise WHERE id = NEW.template_exercise_id) AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_session_insert AFTER INSERT ON workout_session
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_workout_exercise_insert AFTER INSERT ON workout_exercise
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.session_id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_workout_set_insert AFTER INSERT ON workout_set
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT (SELECT session_id FROM workout_exercise WHERE id = NEW.workout_exercise_id) AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_measurement_insert AFTER INSERT ON body_measurement
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'measurement', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'measurement' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_exercise_update AFTER UPDATE ON exercise
                WHEN (SELECT applying FROM sync_flags) = 0 AND NEW.is_built_in = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'exercise', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'exercise' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_update AFTER UPDATE ON workout_template
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_exercise_update AFTER UPDATE ON template_exercise
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.template_id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_set_update AFTER UPDATE ON template_set
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT (SELECT template_id FROM template_exercise WHERE id = NEW.template_exercise_id) AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_session_update AFTER UPDATE ON workout_session
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_workout_exercise_update AFTER UPDATE ON workout_exercise
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.session_id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_workout_set_update AFTER UPDATE ON workout_set
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT (SELECT session_id FROM workout_exercise WHERE id = NEW.workout_exercise_id) AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_measurement_update AFTER UPDATE ON body_measurement
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'measurement', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT NEW.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'measurement' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_exercise_delete AFTER DELETE ON exercise
                WHEN (SELECT applying FROM sync_flags) = 0 AND OLD.is_built_in = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'exercise', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT OLD.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'exercise' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_delete AFTER DELETE ON workout_template
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT OLD.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_exercise_delete AFTER DELETE ON template_exercise
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT OLD.template_id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_template_set_delete AFTER DELETE ON template_set
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'template', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT (SELECT template_id FROM template_exercise WHERE id = OLD.template_exercise_id) AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'template' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_session_delete AFTER DELETE ON workout_session
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT OLD.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_workout_exercise_delete AFTER DELETE ON workout_exercise
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT OLD.session_id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_workout_set_delete AFTER DELETE ON workout_set
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'session', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT (SELECT session_id FROM workout_exercise WHERE id = OLD.workout_exercise_id) AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'session' AND o.entity_id = root.id AND o.payload IS NULL);
                END;

                CREATE TRIGGER sync_measurement_delete AFTER DELETE ON body_measurement
                WHEN (SELECT applying FROM sync_flags) = 0
                BEGIN
                    INSERT INTO outbox (entity, entity_id, created_at)
                    SELECT 'measurement', root.id, strftime('%Y-%m-%d %H:%M:%f', 'now')
                    FROM (SELECT OLD.id AS id) AS root
                    WHERE root.id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'measurement' AND o.entity_id = root.id AND o.payload IS NULL);
                END;
                """)
        }
        return migrator
    }
}
