-- 永久清除标记：阻止已经通过 R2 校验、但晚于 purge 落库的在途喜欢重新制造孤儿计数。
CREATE TABLE IF NOT EXISTS engagement_tombstones (
  scope TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, item_id, kind),
  CHECK (scope = 'community'),
  CHECK (kind = 'like')
) WITHOUT ROWID;
