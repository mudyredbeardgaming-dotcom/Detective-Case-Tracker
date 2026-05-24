-- ─────────────────────────────────────────────────────────────────────────────
-- CID Case Tracker — Complete Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query → Run
-- Safe to re-run on an existing database — all statements are idempotent.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── Profiles ────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users with CID-specific fields.
-- id has NO foreign key to auth.users so manually-added detectives work.

CREATE TABLE IF NOT EXISTS profiles (
  id               UUID PRIMARY KEY,
  discord_username TEXT NOT NULL DEFAULT 'Unknown',
  discord_id       TEXT,
  display_name     TEXT DEFAULT '',
  role             TEXT NOT NULL DEFAULT 'pending',
  badge            TEXT DEFAULT '',
  approved         BOOLEAN NOT NULL DEFAULT FALSE,
  added_by         TEXT DEFAULT 'discord',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drop the old FK constraint if upgrading from the original schema
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Add display_name column if upgrading from older schema
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT '';

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read profiles"  ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile"           ON profiles;
DROP POLICY IF EXISTS "Users can insert profiles"              ON profiles;
DROP POLICY IF EXISTS "Authenticated users can update profiles" ON profiles;
DROP POLICY IF EXISTS "Authenticated users can delete profiles" ON profiles;

CREATE POLICY "Authenticated users can read profiles"
  ON profiles FOR SELECT TO authenticated USING (true);

-- Allow any authenticated user to insert a profile row (needed for manually-added detectives)
CREATE POLICY "Users can insert profiles"
  ON profiles FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update profiles"
  ON profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete profiles"
  ON profiles FOR DELETE TO authenticated USING (true);


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
  created_by   UUID
);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can read cases"   ON cases;
DROP POLICY IF EXISTS "Approved users can insert cases" ON cases;
DROP POLICY IF EXISTS "Approved users can update cases" ON cases;
DROP POLICY IF EXISTS "Approved users can delete cases" ON cases;

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
-- Tracks the last-used number for each case type code (A, G, N, H, K, D, R, O, IA).
-- Starts at 999 so the first case of each type is X-1000.

CREATE TABLE IF NOT EXISTS case_counters (
  code    TEXT PRIMARY KEY,
  counter INTEGER NOT NULL DEFAULT 999
);

ALTER TABLE case_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can manage counters" ON case_counters;

CREATE POLICY "Approved users can manage counters"
  ON case_counters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved = TRUE));


-- ─── Auto-create profile on Discord sign-in ──────────────────────────────────
-- Fires when a new row is inserted into auth.users (Discord OAuth).
-- If the Discord ID matches a manually-added profile, merges the two rows.
-- EXCEPTION handler ensures a trigger error never blocks the user's login.

CREATE OR REPLACE FUNCTION handle_new_discord_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing_id UUID;
BEGIN
  -- Check if a manually-added profile already exists for this Discord ID
  SELECT id INTO existing_id
  FROM profiles
  WHERE discord_id = NEW.raw_user_meta_data->>'provider_id'
    AND discord_id IS NOT NULL
    AND discord_id != ''
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    -- Merge: give the manual profile the real auth UUID so login works
    UPDATE profiles SET id = NEW.id WHERE id = existing_id;
  ELSE
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
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block login due to a trigger error
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_discord_user();


-- ─── Atomic Case Operations ───────────────────────────────────────────────────
-- RPC functions used by the app instead of client-side read-modify-write.
-- SECURITY DEFINER so they bypass RLS and run as the function owner (postgres),
-- which means two detectives can update the same case simultaneously without
-- one overwriting the other's changes.

CREATE OR REPLACE FUNCTION add_case_note(p_case_id TEXT, p_note JSONB, p_status TEXT DEFAULT NULL)
RETURNS SETOF cases LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE cases
  SET notes      = COALESCE(notes, '[]'::jsonb) || jsonb_build_array(p_note),
      status     = COALESCE(NULLIF(p_status, ''), status),
      closed_at  = CASE WHEN p_status = 'Closed' THEN COALESCE(closed_at, NOW()) ELSE closed_at END,
      updated_at = NOW()
  WHERE id = p_case_id
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION add_case_report(p_case_id TEXT, p_report JSONB)
RETURNS SETOF cases LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE cases
  SET reports    = COALESCE(reports, '[]'::jsonb) || jsonb_build_array(p_report),
      updated_at = NOW()
  WHERE id = p_case_id
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION add_case_person(p_case_id TEXT, p_person JSONB)
RETURNS SETOF cases LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE cases
  SET persons    = COALESCE(persons, '[]'::jsonb) || jsonb_build_array(p_person),
      updated_at = NOW()
  WHERE id = p_case_id
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION remove_from_case(p_case_id TEXT, p_field TEXT, p_item_id TEXT)
RETURNS SETOF cases LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_field = 'notes' THEN
    UPDATE cases
    SET notes      = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(notes)   e WHERE e->>'id' != p_item_id),
        updated_at = NOW()
    WHERE id = p_case_id;
  ELSIF p_field = 'reports' THEN
    UPDATE cases
    SET reports    = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(reports) e WHERE e->>'id' != p_item_id),
        updated_at = NOW()
    WHERE id = p_case_id;
  ELSIF p_field = 'persons' THEN
    UPDATE cases
    SET persons    = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(persons) e WHERE e->>'id' != p_item_id),
        updated_at = NOW()
    WHERE id = p_case_id;
  END IF;
  RETURN QUERY SELECT * FROM cases WHERE id = p_case_id;
END;
$$;
