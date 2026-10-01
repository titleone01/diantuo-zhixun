CREATE TABLE training_drawings_next (
  projectId TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'schematic' CHECK(kind IN ('schematic','layout')),
  title TEXT NOT NULL,
  mediaId TEXT NOT NULL REFERENCES media(id),
  updatedBy TEXT NOT NULL REFERENCES user(id),
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (projectId, kind)
);
INSERT INTO training_drawings_next(projectId,kind,title,mediaId,updatedBy,updatedAt)
SELECT projectId,'schematic',title,mediaId,updatedBy,updatedAt FROM training_drawings;
DROP TABLE training_drawings;
ALTER TABLE training_drawings_next RENAME TO training_drawings;
CREATE INDEX training_drawings_media ON training_drawings(mediaId);
