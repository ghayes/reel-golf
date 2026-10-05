(async () => {
  const logs = document.getElementById('logs');
  const message = (text) => { logs.textContent = text; };
  try {
    const params = new URLSearchParams({ state: 'closed', labels: 'type: feature' });
    const res = await fetch('https://api.github.com/repos/ghayes/reel-golf/issues?' + params);
    if (!res.ok) throw new Error('GitHub API responded ' + res.status);
    const issues = await res.json();
    if (!Array.isArray(issues)) throw new Error('Unexpected GitHub API response');
    if (!issues.length) { message('No features logged yet.'); return; }

    // Build with DOM nodes + textContent: issue titles are user-controlled text.
    logs.textContent = '';
    for (const issue of issues) {
      const entry = document.createElement('div');
      entry.className = 'entry';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = String(issue.title ?? '');
      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = issue.closed_at ? new Date(issue.closed_at).toLocaleDateString() : '';
      entry.append(title, date);
      logs.append(entry);
    }
  } catch (err) {
    console.warn('changelog load failed', err);
    message('Couldn\u2019t load the feature log right now.');
  }
})();
