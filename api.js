// ============================================================
// REEL GOLF — Shared Supabase API & State Module (api.js)
// ============================================================
(() => {
  'use strict';

  const SUPABASE_URL = 'https://allwunqurqgdaxjnovhh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsbHd1bnF1cnFnZGF4am5vdmhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNjgwNzUsImV4cCI6MjA5OTY0NDA3NX0.AamB6_7XYRnlPt9XqNxb4MZaU9qyFVPC9CoybQRa-FY';

  let sb = null;
  try {
    if (typeof window !== 'undefined' && window.supabase) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch (e) {
    console.warn('Supabase init failed', e);
  }

  const RG_API = {
    sb,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    user: null,
    username: null,
    coins: 0,
    inventory: new Set(),
    shopCatalog: [],

    hasUpgrade(key) {
      return this.inventory.has(key);
    },

    randomUsername() {
      const adjs = ['Rusty', 'Windy', 'Lucky', 'Quiet', 'Salty', 'Rowdy', 'Foggy', 'Sunny', 'Grizzled', 'Stormy'];
      const nouns = ['Angler', 'Caster', 'Dockhand', 'Skipper', 'Wader', 'Trawler', 'Baitman', 'Reelman'];
      const a = adjs[Math.floor(Math.random() * adjs.length)];
      const n = nouns[Math.floor(Math.random() * nouns.length)];
      return a + n + Math.floor(100 + Math.random() * 900);
    },

    async ensurePlayerRow() {
      if (!sb || !this.user) return;
      try {
        const { data, error } = await sb.from('players')
          .select('id,username,coins')
          .eq('id', this.user.id)
          .maybeSingle();

        if (error) {
          console.warn('players lookup failed', error);
          return;
        }

        if (data) {
          this.username = data.username;
          if (data.coins !== undefined) this.coins = data.coins;
        } else {
          this.username = this.randomUsername();
          this.coins = 0;
          const { error: insErr } = await sb.from('players').insert({
            id: this.user.id,
            username: this.username,
            coins: 0
          });
          if (insErr) console.warn('players insert failed', insErr);
        }
      } catch (e) {
        console.warn('ensurePlayerRow exception', e);
      }
    },

    async loadPlayerData() {
      if (!sb || !this.user) {
        this.coins = 0;
        this.inventory.clear();
        return;
      }
      try {
        const [{ data: pData }, { data: invData }] = await Promise.all([
          sb.from('players').select('coins').eq('id', this.user.id).maybeSingle(),
          sb.from('player_inventory').select('item_id, shop_items(asset_key)').eq('player_id', this.user.id)
        ]);
        if (pData && pData.coins !== undefined) this.coins = pData.coins;
        this.inventory.clear();
        if (invData) {
          for (const row of invData) {
            if (row.shop_items && row.shop_items.asset_key) {
              this.inventory.add(row.shop_items.asset_key);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load player data', e);
      }
    },

    async loadShopCatalog() {
      if (!sb) return [];
      try {
        const { data, error } = await sb.from('shop_items').select('*').order('cost', { ascending: true });
        if (!error && data && data.length) {
          this.shopCatalog = data;
          return data;
        }
      } catch (e) {
        console.warn('Failed to load shop catalog', e);
      }
      return this.shopCatalog;
    },

    async purchaseItem(itemId) {
      if (!sb) throw new Error('Supabase client unavailable');
      if (!this.user) throw new Error('Login required to purchase items');
      const { data, error } = await sb.rpc('purchase_item', { p_item_id: itemId });
      if (error) throw error;
      return data;
    },

    async submitRound(summary) {
      if (!sb || !this.user) return null;
      try {
        // Attempt secure RPC submission first
        const { data: rpcData, error: rpcErr } = await sb.rpc('submit_round', {
          p_score: summary.score,
          p_best_dist: summary.bestDist,
          p_fish_caught: summary.fishCaught,
          p_catches: summary.catches || [],
          p_ring2x: !!summary.ring2x,
          p_lifetime_snaps: summary.lifetimeSnaps || 0
        });
        if (!rpcErr) return rpcData;

        // Fallback for legacy database schema setup
        console.warn('submit_round RPC unavailable, using direct table submission', rpcErr);
        const { data: playerRow } = await sb.from('players')
          .select('total_score,best_distance,balls_played,coins').eq('id', this.user.id).maybeSingle();

        await sb.from('players').update({
          total_score: (playerRow?.total_score || 0) + summary.score,
          coins: (playerRow?.coins || 0) + Math.floor(summary.score / 10),
          best_distance: Math.max(playerRow?.best_distance || 0, summary.bestDist),
          balls_played: (playerRow?.balls_played || 0) + 3,
        }).eq('id', this.user.id);

        const { data: roundRow, error: roundErr } = await sb.from('rounds')
          .insert({ player_id: this.user.id, score: summary.score, fish_caught: summary.fishCaught })
          .select('id').single();
        if (roundErr) throw roundErr;

        if (summary.catches && summary.catches.length) {
          const rows = summary.catches.map(c => ({
            player_id: this.user.id,
            round_id: roundRow.id,
            species: c.species,
            distance_yd: c.distance_yd,
            bonus_points: c.bonus_points,
          }));
          await sb.from('catches').insert(rows);
        }

        const trophyCodes = [];
        if (summary.fishCaught > 0) trophyCodes.push('first_fish');
        if (summary.catches && summary.catches.some(c => c.species === 'PIKE')) trophyCodes.push('first_pike');
        if (summary.ring2x) trophyCodes.push('double_ring');
        if (summary.bestDist >= 150) trophyCodes.push('long_drive_150');
        if (summary.score >= 100) trophyCodes.push('century_score');
        if (summary.score >= 1000) trophyCodes.push('thousand_score');
        if (summary.lifetimeSnaps >= 5) trophyCodes.push('snap_five');

        if (trophyCodes.length) {
          const rows = trophyCodes.map(code => ({ player_id: this.user.id, trophy_code: code }));
          await sb.from('player_trophies')
            .upsert(rows, { onConflict: 'player_id,trophy_code', ignoreDuplicates: true });
        }
        return roundRow;
      } catch (e) {
        console.warn('Supabase round sync failed', e);
        return null;
      }
    },

    async signInWithOtp(email) {
      if (!sb) throw new Error('Offline');
      const redirectUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.reel-golf.com';
      return await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectUrl }
      });
    },

    async verifyOtp(email, token) {
      if (!sb) throw new Error('Offline');
      return await sb.auth.verifyOtp({ email, token, type: 'email' });
    },

    async signOut() {
      if (!sb) return;
      const res = await sb.auth.signOut();
      this.user = null;
      this.username = null;
      this.coins = 0;
      this.inventory.clear();
      return res;
    },

    async saveUsername(newName) {
      if (!sb || !this.user) throw new Error('Not logged in');
      const { error } = await sb.from('players').update({ username: newName }).eq('id', this.user.id);
      if (error) throw error;
      this.username = newName;
    },

    initAuth(onAuthChange) {
      if (!sb) return;

      sb.auth.getSession().then(async ({ data: { session } }) => {
        if (session && session.user) {
          this.user = session.user;
          await this.ensurePlayerRow();
          await this.loadPlayerData();
        } else {
          this.user = null;
          this.username = null;
          this.coins = 0;
          this.inventory.clear();
        }
        if (onAuthChange) onAuthChange(session);
      });

      sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session && session.user) {
          this.user = session.user;
          await this.ensurePlayerRow();
          await this.loadPlayerData();
        } else if (event === 'SIGNED_OUT') {
          this.user = null;
          this.username = null;
          this.coins = 0;
          this.inventory.clear();
        }
        if (onAuthChange) onAuthChange(session);
      });
    }
  };

  if (typeof window !== 'undefined') {
    window.RG_API = RG_API;
    window.sb = sb; // Backward compatibility for standalone queries
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RG_API;
  }
})();
