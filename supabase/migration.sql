-- Supabase migration: YouTube Comment Bot license keys
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS yt_comment_bot_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  product text NOT NULL DEFAULT 'yt-comment-bot',
  telegram_user_id bigint NOT NULL,
  hardware_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by key
CREATE INDEX IF NOT EXISTS idx_yt_keys_key ON yt_comment_bot_keys (key);

-- Index for counting keys per telegram user
CREATE INDEX IF NOT EXISTS idx_yt_keys_tg_user ON yt_comment_bot_keys (telegram_user_id, product);

-- RLS: enable row level security
ALTER TABLE yt_comment_bot_keys ENABLE ROW LEVEL SECURITY;

-- Policy: allow Edge Functions (service_role) full access
-- No public access - all validation goes through Edge Function
CREATE POLICY "Service role full access" ON yt_comment_bot_keys
  FOR ALL
  USING (true)
  WITH CHECK (true);
