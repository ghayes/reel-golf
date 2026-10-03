export async function onRequest(context) {
  const url = new URL(context.request.url);
  const hostname = url.hostname.toLowerCase();

  // Handle requests directed to apex domain or www subdomain
  if (hostname === 'reel-golf.com' || hostname === 'www.reel-golf.com') {
    // Redirect /play or /play/ to the game application subdomain
    if (url.pathname === '/play' || url.pathname === '/play/') {
      return Response.redirect('https://app.reel-golf.com', 302);
    }

    // Rewrite root path to the landing page
    if (url.pathname === '/' || url.pathname === '') {
      const landingUrl = new URL('/landing.html', url.origin);
      if (context.env && context.env.ASSETS && typeof context.env.ASSETS.fetch === 'function') {
        return context.env.ASSETS.fetch(new Request(landingUrl.toString(), context.request));
      }
      return context.next(new Request(landingUrl.toString(), context.request));
    }
  }

  // All other domains and assets proceed normally to the asset server
  return context.next();
}
