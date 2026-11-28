-- A snippet of the latest reply, shown under each chat's title in the history list.
ALTER TABLE chats ADD COLUMN preview TEXT NOT NULL DEFAULT '';
