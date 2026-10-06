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
        // Own row only, via an owner-checked RPC: `players.coins` is not
        // readable by clients (see 20261009000001_hide_player_columns_from_authenticated.sql).
        const { data, error } = await sb.rpc('get_my_player').maybeSingle();

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
          // Only id/username are client-writable; stat columns default to 0
          // server-side (see migration 20261004000000_lock_players_writes.sql).
          const { error: insErr } = await sb.from('players').insert({
            id: this.user.id,
            username: this.username
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
          sb.rpc('get_my_player').maybeSingle(),
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
        // Scores are recorded only through the server-side RPC
        const { data: rpcData, error: rpcErr } = await sb.rpc('submit_round', {
          p_score: summary.score,
          p_best_dist: summary.bestDist,
          p_fish_caught: summary.fishCaught,
          p_catches: summary.catches || [],
          p_ring2x: !!summary.ring2x,
          p_round_snaps: summary.snaps || 0
        });
        if (rpcErr) {
          // No client-side fallback: player stats are only writable via the
          // submit_round RPC (see 20261004000000_lock_players_writes.sql).
          console.warn('submit_round RPC failed', rpcErr);
          return null;
        }
        return rpcData;
      } catch (e) {
        console.warn('Supabase round sync failed', e);
        return null;
      }
    },

    normalizePhone(phone) {
      if (!phone) return '';
      const clean = phone.trim();
      const digitsOnly = clean.replace(/[^\d+]/g, '');
      if (digitsOnly.startsWith('+')) {
        return digitsOnly;
      }
      if (digitsOnly.length === 10) {
        return '+1' + digitsOnly;
      }
      if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        return '+' + digitsOnly;
      }
      return '+' + digitsOnly;
    },

    async signInWithPhone(phone) {
      if (!sb) throw new Error('Offline');
      const normalized = this.normalizePhone(phone);
      if (!normalized || normalized.length < 11) {
        throw new Error('Please enter a valid phone number');
      }
      return await sb.auth.signInWithOtp({
        phone: normalized
      });
    },

    async verifyPhoneOtp(phone, token) {
      if (!sb) throw new Error('Offline');
      const normalized = this.normalizePhone(phone);
      const res = await sb.auth.verifyOtp({
        phone: normalized,
        token: token.trim(),
        type: 'sms'
      });
      if (!res.error && res.data && res.data.user) {
        this.user = res.data.user;
        await this.ensurePlayerRow();
        await this.loadPlayerData();
      }
      return res;
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
      const res = await sb.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
      if (!res.error && res.data && res.data.user) {
        this.user = res.data.user;
        await this.ensurePlayerRow();
        await this.loadPlayerData();
      }
      return res;
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

    async syncUser(session) {
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
    },

    initAuth(onAuthChange) {
      if (!sb) return;

      sb.auth.onAuthStateChange(async (event, session) => {
        await this.syncUser(session);
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
