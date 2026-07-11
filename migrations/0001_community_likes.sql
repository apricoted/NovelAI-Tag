-- 共创广场公开喜欢：关系表是真相源，统计表由 trigger 同步维护。
CREATE TABLE IF NOT EXISTS engagements (
  scope TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, item_id, kind, actor_id),
  CHECK (scope = 'community'),
  CHECK (kind = 'like')
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS engagements_actor_idx
  ON engagements (scope, kind, actor_id, item_id);

CREATE TABLE IF NOT EXISTS engagement_stats (
  scope TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, item_id, kind),
  CHECK (scope = 'community'),
  CHECK (kind = 'like'),
  CHECK (like_count >= 0)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS engagement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (scope = 'community'),
  CHECK (kind = 'like'),
  CHECK (action IN ('add', 'remove'))
);

CREATE INDEX IF NOT EXISTS engagement_events_created_idx
  ON engagement_events (created_at);

CREATE INDEX IF NOT EXISTS engagement_events_item_idx
  ON engagement_events (scope, kind, item_id, created_at);

CREATE TABLE IF NOT EXISTS engagement_rate_buckets (
  identifier_type TEXT NOT NULL,
  identifier_hash TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (identifier_type, identifier_hash, bucket_start),
  CHECK (identifier_type IN ('actor', 'ip')),
  CHECK (request_count >= 0)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS engagement_rate_buckets_expiry_idx
  ON engagement_rate_buckets (expires_at);

CREATE TRIGGER IF NOT EXISTS engagements_after_insert
AFTER INSERT ON engagements
BEGIN
  INSERT INTO engagement_stats (scope, item_id, kind, like_count, updated_at)
  VALUES (NEW.scope, NEW.item_id, NEW.kind, 1, NEW.created_at)
  ON CONFLICT (scope, item_id, kind) DO UPDATE SET
    like_count = engagement_stats.like_count + 1,
    updated_at = excluded.updated_at;

  INSERT INTO engagement_events (scope, item_id, kind, action, created_at)
  VALUES (NEW.scope, NEW.item_id, NEW.kind, 'add', NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS engagements_after_delete
AFTER DELETE ON engagements
BEGIN
  UPDATE engagement_stats
  SET like_count = MAX(0, like_count - 1),
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE scope = OLD.scope AND item_id = OLD.item_id AND kind = OLD.kind;

  DELETE FROM engagement_stats
  WHERE scope = OLD.scope AND item_id = OLD.item_id AND kind = OLD.kind AND like_count = 0;

  INSERT INTO engagement_events (scope, item_id, kind, action, created_at)
  VALUES (
    OLD.scope,
    OLD.item_id,
    OLD.kind,
    'remove',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  );
END;
