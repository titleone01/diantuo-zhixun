CREATE TABLE training_drawings (projectId TEXT PRIMARY KEY, title TEXT NOT NULL, mediaId TEXT NOT NULL REFERENCES media(id), updatedBy TEXT NOT NULL REFERENCES user(id), updatedAt INTEGER NOT NULL);
