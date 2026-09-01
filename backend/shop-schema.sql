-- Add currency to players
alter table players add column coins int not null default 0;

-- Define items for sale
create table shop_items (
  id          serial primary key,
  name        text not null,
  description text,
  cost        int not null,
  item_type   text not null, -- 'ROD', 'BAIT', 'SKIN'
  asset_key   text           -- reference to game asset
);

-- Track player ownership
create table player_inventory (
  player_id   uuid not null references players(id) on delete cascade,
  item_id     int not null references shop_items(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  primary key (player_id, item_id)
);

-- RLS setup
alter table shop_items enable row level security;
alter table player_inventory enable row level security;

create policy "public read: shop_items" on shop_items for select using (true);
create policy "self read: inventory" on player_inventory for select using (auth.uid() = player_id);
-- Note: Direct client INSERT on player_inventory is intentionally omitted to prevent
-- players from bypassing purchase_item() RPC to acquire items for free.
