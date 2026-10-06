-- ============================================================
-- HISTORICAL FILE. DO NOT RE-RUN ON A LIVE DATABASE.
-- SUPERSEDED by the upsert in supabase/migrations/20261006000000_harden_shop.sql.
-- This file uses ON CONFLICT (id), which no longer works against the UNIQUE(asset_key) catalog.
-- The source of truth for the schema is supabase/migrations/ (applied in
-- filename order). See CLAUDE.md and issue #47.
-- ============================================================

-- Seed initial shop items
insert into shop_items (name, description, cost, item_type, asset_key) values
  ('Graphite Rod', '+10% max drive launch speed', 150, 'ROD', 'graphite_rod'),
  ('Braided Line', '+20% max line tension tolerance', 200, 'LINE', 'braided_line'),
  ('Super Bait', 'Increases fish bite chance by +25%', 100, 'BAIT', 'super_bait'),
  ('Titanium Reel', '+20% faster reeling speed', 250, 'REEL', 'titanium_reel'),
  ('Neon Ball', 'Bright neon glow and ball trail', 100, 'SKIN', 'neon_ball')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  cost = excluded.cost,
  item_type = excluded.item_type,
  asset_key = excluded.asset_key;
