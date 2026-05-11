-- ─────────────────────────────────────────────────────────────────────────────
-- CID Case Tracker — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Profiles ────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users with CID-specific fields
CREATE TABLE IF NOT EXISTS profiles (
  id               UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  discord_username TEXT NOT NULL DEFAULT 'Unknown',
  discord_id       TEXT,
  role             TEXT NOT NULL DEFAULT 'pending',
  badge            TEXT DEFAULT '',
  approved         BOOLEAN NOT NULL DEFAULT FALSE,
  added_by         TEXT DEFAULT 'discord',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- All logged-in users can see all profiles (needed to build assign-detective dropdowns)
CREATE POLICY "Authenticated users can read profiles"
  ON profiles FOR SELECT TO authenticated USING (true);

-- Users can create their own profile row
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Any authenticated user can update profiles (app logic enforces Det III/Command restriction)
CREATE POLICY "Authenticated users can update profiles"
  ON profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── Cases ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  id           TEXT PRIMARY KEY,
  case_number  TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Open',
  priority     TEXT DEFAULT 'Medium',
  detective    TEXT DEFAULT '',
  badge        TEXT DEFAULT '',
  location     TEXT DEFAULT '',
  summary      TEXT DEFAULT '',
  opened_at    DATE,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  notes        JSONB DEFAULT '[]',
  reports      JSONB DEFAULT '[]',
  persons      JSONB DEFAULT '[]',
  created_by   UUID REFERENCES auth.users(id)
);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

-- Only approved users can access cases
CREATE POLICY "Approved users can read cases"
  ON cases FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE));

CREATE POLICY "Approved users can insert cases"
  ON cases FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE));

CREATE POLICY "Approved users can update cases"
  ON cases FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE));

CREATE POLICY "Approved users can delete cases"
  ON cases FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE));

-- ─── Case Counters ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_counters (
  code    TEXT PRIMARY KEY,
  counter INTEGER NOT NULL DEFAULT 999
);

ALTER TABLE case_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can manage counters"
  ON case_counters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE));

-- ─── Auto-create profile on Discord sign-in ──────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_discord_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, discord_username, discord_id, role, approved, added_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Unknown'),
    NEW.raw_user_meta_data->>'provider_id',
    'pending',
    FALSE,
    'discord'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_discord_user();
