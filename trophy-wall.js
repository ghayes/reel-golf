(async () => {
  const content = document.getElementById('content');
  function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  try {
    const sb = window.RG_API?.sb || window.sb;
    const [{ data: defs, error: defErr }, { data: wall, error: wallErr }, { data: history, error: histErr }] = await Promise.all([
      sb.from('trophy_defs').select('code,name,description,icon'),
      sb.from('trophy_wall').select('username,total_score,best_distance,total_catches,pikes_landed,trophies'),
      sb.from('player_trophies').select('trophy_code,earned_at,players(username)').order('earned_at', { ascending: false }),
    ]);
    if (defErr) throw defErr;
    if (wallErr) throw wallErr;
    if (histErr) throw histErr;
    const legend = `<div class="legend">${defs.map(d => `<div class="badge" title="${esc(d.description)}"><span class="icon">${d.icon||'🏆'}</span>${esc(d.name)}</div>`).join('')}</div>`;
    const ranked = wall.map(p => ({ ...p, trophies: (p.trophies||[]).filter(Boolean) })).sort((a,b) => b.trophies.length - a.trophies.length || b.total_score - a.total_score);
    const cards = ranked.map(p => {
      const earned = new Set(p.trophies);
      const badges = defs.map(d => `<div class="badge-slot ${earned.has(d.code)?'earned':''}" title="${esc(d.description)}"><span class="icon">${d.icon||'🏆'}</span>${esc(d.name)}</div>`).join('');
      return `<div class="card"><div class="head"><span class="uname">${esc(p.username)}</span><span class="stats">${p.total_score} pts &middot; ${Math.round(p.best_distance)} yd best &middot; ${p.total_catches} fish</span></div><div class="badges">${badges}</div></div>`;
    }).join('');
    const timeline = `<div class="card">${history.map(h => {
        const def = defs.find(d => d.code === h.trophy_code);
        const date = new Date(h.earned_at).toLocaleDateString();
        return `<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span>${date} — <span class="icon">${def?.icon||'🏆'}</span> <b>${esc(def?.name||h.trophy_code)}</b></span><span style="opacity:0.6; font-size:12px;">${esc(h.players.username)}</span></div>`;
    }).join('')}</div>`;
    document.getElementById('trophyGrid').innerHTML = legend + cards;
    document.getElementById('trophyHistory').innerHTML = timeline;
    document.getElementById('viewGrid').addEventListener('click', () => { 
        document.getElementById('trophyGrid').classList.remove('hidden'); 
        document.getElementById('trophyHistory').classList.add('hidden');
        document.getElementById('viewGrid').classList.add('active');
        document.getElementById('viewHistory').classList.remove('active');
    });
    document.getElementById('viewHistory').addEventListener('click', () => { 
        document.getElementById('trophyHistory').classList.remove('hidden'); 
        document.getElementById('trophyGrid').classList.add('hidden');
        document.getElementById('viewHistory').classList.add('active');
        document.getElementById('viewGrid').classList.remove('active');
    });
  } catch(e){ console.warn('trophy wall load failed', e); content.innerHTML = '<div class="state">Couldn’t load the trophy wall right now.</div>'; }
})();
