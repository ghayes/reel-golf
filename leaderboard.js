(() => {
  const content = document.getElementById('content');
  const PAGE_SIZE = 10;
  let page = 0;
  let total = 0;
  const sb = window.RG_API?.sb || window.sb;

  function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  async function loadPage(p){
    content.innerHTML = '<div class="state">Loading scores&hellip;</div>';
    try {
      const from = p*PAGE_SIZE, to = from+PAGE_SIZE-1;
      const { data, count, error } = await sb.from('trophy_wall')
        .select('username,total_score,best_distance,total_catches,pikes_landed', { count:'exact' })
        .order('total_score', { ascending:false })
        .range(from, to);
      if (error) throw error;
      total = count || 0;
      page = p;

      if (!total){
        content.innerHTML = '<div class="state">No rounds played yet — be the first!</div>';
        return;
      }

      const rows = data.map((pl,i) => {
        const rank = from+i+1;
        const rankCls = rank===1?'top1':rank===2?'top2':rank===3?'top3':'';
        return `<tr>
          <td class="rank ${rankCls}">${rank}</td>
          <td class="uname">${esc(pl.username)}</td>
          <td class="num score">${num(pl.total_score)}</td>
          <td class="num">${Math.round(num(pl.best_distance))} yd</td>
          <td class="num">${num(pl.total_catches)}${num(pl.pikes_landed)>0 ? ' 🐊'+num(pl.pikes_landed) : ''}</td>
        </tr>`;
      }).join('');

      const pageCount = Math.max(1, Math.ceil(total/PAGE_SIZE));
      content.innerHTML = `<table>
        <thead><tr>
          <th>#</th><th>Player</th>
          <th class="num">Score</th><th class="num">Best Drive</th><th class="num">Fish</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="pager">
        <button id="prevBtn" ${page===0?'disabled':''}>&larr; Prev</button>
        <span class="pageNum">Page ${page+1} of ${pageCount}</span>
        <button id="nextBtn" ${page>=pageCount-1?'disabled':''}>Next &rarr;</button>
      </div>`;

      document.getElementById('prevBtn').addEventListener('click', () => { if (page>0) loadPage(page-1); });
      document.getElementById('nextBtn').addEventListener('click', () => { if (page<pageCount-1) loadPage(page+1); });
    } catch(e){
      console.warn('leaderboard load failed', e);
      content.innerHTML = '<div class="state">Couldn’t load the leaderboard right now.</div>';
    }
  }

  loadPage(0);
})();
