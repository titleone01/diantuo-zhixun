-- The existing primary keys begin with userId/publicationId respectively.
-- These reverse lookups serve gallery counts and private-media authorization.
CREATE INDEX IF NOT EXISTS reactions_publication_kind ON reactions(publicationId,kind);
CREATE INDEX IF NOT EXISTS publication_media_media ON publication_media(mediaId);
