-- Append-only migration: retain all associations, media, titles and publication snapshots.
ALTER TABLE training_drawings ADD COLUMN version TEXT NOT NULL DEFAULT '';
UPDATE training_drawings SET version = lower(hex(randomblob(16))) WHERE version = '';
