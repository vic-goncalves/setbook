-- Coach conversations, saved so they can be reopened and continued on any device.
-- body is the conversation exactly as the browser sends it to the model (thinking blocks
-- included) plus the user's approve/decline decisions.
CREATE TABLE chats (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
);
CREATE INDEX chats_by_updated ON chats (user_id, updated_at);
