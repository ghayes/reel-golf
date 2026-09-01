-- RPC Function: Purchase Item
-- This function atomically deducts coins and adds an item to inventory.

create or replace function purchase_item(p_item_id int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cost int;
    v_player_id uuid;
    v_coins int;
begin
    v_player_id := auth.uid();
    if v_player_id is null then
        raise exception 'Not authenticated';
    end if;

    -- Check if player already owns the item
    if exists (select 1 from player_inventory where player_id = v_player_id and item_id = p_item_id) then
        raise exception 'Item already owned';
    end if;

    -- Get the cost of the item
    select cost into v_cost from shop_items where id = p_item_id;
    if not found then
        raise exception 'Item not found';
    end if;

    -- Check player coins
    select coins into v_coins from players where id = v_player_id;
    if v_coins is null or v_coins < v_cost then
        raise exception 'Insufficient coins';
    end if;

    -- Deduct coins
    update players
    set coins = coins - v_cost
    where id = v_player_id;

    -- Grant the item
    insert into player_inventory (player_id, item_id)
    values (v_player_id, p_item_id);
end;
$$;
