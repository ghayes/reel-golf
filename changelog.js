  (async () => {
    const res = await fetch('https://api.github.com/repos/ghayes/reel-golf/issues?state=closed&labels=type: feature');
    const issues = await res.json();
    document.getElementById('logs').innerHTML = issues.map(i => `
      <div class="entry">
        <div class="title">${i.title}</div>
        <div class="date">${new Date(i.closed_at).toLocaleDateString()}</div>
      </div>
    `).join('');
  })();
