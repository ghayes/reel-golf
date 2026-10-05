(() => {
  'use strict';

  // DOM elements
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const shopBtn = document.getElementById('shopBtn');
  const openShopLink = document.getElementById('openShopLink');
  const shopOverlay = document.getElementById('shopOverlay');
  const shopCloseBtn = document.getElementById('shopCloseBtn');
  const shopItemList = document.getElementById('shopItemList');
  const shopCoinDisplay = document.getElementById('shopCoinDisplay');
  const shopMsg = document.getElementById('shopMsg');
  const rulesBlock = document.getElementById('rulesBlock');
  const finalStats = document.getElementById('finalStats');
  const authTabs = document.getElementById('authTabs');
  const authTabBtns = document.querySelectorAll('.auth-tab');
  const userRow = document.getElementById('userRow');
  const usernameInput = document.getElementById('usernameInput');
  const phoneInput = document.getElementById('phoneInput');
  const emailInput = document.getElementById('emailInput');
  const usernameSave = document.getElementById('usernameSave');
  const logoutBtn = document.getElementById('logoutBtn');
  const phoneConsentRow = document.getElementById('phoneConsentRow');
  const phoneConsent = document.getElementById('phoneConsent');
  const userMsg = document.getElementById('userMsg');
  const otpRow = document.getElementById('otpRow');
  const otpInput = document.getElementById('otpInput');
  const otpVerify = document.getElementById('otpVerify');
  const resendOtpBtn = document.getElementById('resendOtpBtn');
  const cancelOtpBtn = document.getElementById('cancelOtpBtn');
  const authLabel = document.getElementById('authLabel');

  let currentAuthTab = localStorage.getItem('rg_auth_pref') || 'phone';
  let resendTimer = null;
  let resendSeconds = 0;

  function setUserMsg(text, ok) {
    userMsg.textContent = text;
    userMsg.classList.toggle('ok', !!ok);
  }

  function setShopMsg(text, ok) {
    if (!shopMsg) return;
    shopMsg.textContent = text;
    shopMsg.classList.toggle('ok', !!ok);
  }

  function updateCoinDisplays() {
    if (shopCoinDisplay && window.RG_API) {
      shopCoinDisplay.textContent = window.RG_API.coins;
    }
  }

  function switchAuthTab(tab) {
    currentAuthTab = tab;
    localStorage.setItem('rg_auth_pref', tab);
    authTabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    if (tab === 'phone') {
      phoneInput.classList.remove('hidden');
      emailInput.classList.add('hidden');
      phoneConsentRow.classList.remove('hidden');
    } else {
      emailInput.classList.remove('hidden');
      phoneInput.classList.add('hidden');
      phoneConsentRow.classList.add('hidden');
    }
    setUserMsg('', false);
  }

  async function setAuthState(session) {
    const api = window.RG_API;
    clearInterval(resendTimer);
    otpRow.classList.add('hidden');

    if (session && session.user && api) {
      if (!api.username) {
        await api.ensurePlayerRow();
        await api.loadPlayerData();
      }
      authTabs.classList.add('hidden');
      phoneConsentRow.classList.add('hidden');
      phoneInput.classList.add('hidden');
      emailInput.classList.add('hidden');
      usernameInput.classList.remove('hidden');
      usernameInput.type = 'text';
      usernameInput.value = api.username || session.user.email || 'Player';
      usernameInput.placeholder = 'Your username';
      usernameSave.textContent = 'SAVE';
      authLabel.classList.remove('hidden');
      authLabel.textContent = 'Playing as';
      logoutBtn.classList.remove('hidden');
      userRow.classList.remove('hidden');
    } else {
      authTabs.classList.remove('hidden');
      usernameInput.classList.add('hidden');
      authLabel.classList.add('hidden');
      logoutBtn.classList.add('hidden');
      usernameSave.textContent = 'LOGIN';
      userRow.classList.remove('hidden');
      switchAuthTab(currentAuthTab);
    }
    updateCoinDisplays();
  }

  function startResendCountdown() {
    clearInterval(resendTimer);
    resendSeconds = 45;
    resendOtpBtn.disabled = true;
    resendOtpBtn.textContent = `RESEND (${resendSeconds}s)`;

    resendTimer = setInterval(() => {
      resendSeconds--;
      if (resendSeconds <= 0) {
        clearInterval(resendTimer);
        resendOtpBtn.disabled = false;
        resendOtpBtn.textContent = 'RESEND';
      } else {
        resendOtpBtn.textContent = `RESEND (${resendSeconds}s)`;
      }
    }, 1000);
  }

  async function saveUsername() {
    const api = window.RG_API;
    if (!api || !api.user) return;
    const name = usernameInput.value.trim();
    if (name === api.username) return;
    if (!/^(?!.* {2})[A-Za-z0-9_ ]{3,20}$/.test(name)) {
      setUserMsg('3-20 letters, numbers, single spaces or _', false);
      return;
    }
    usernameSave.disabled = true;
    try {
      await api.saveUsername(name);
      setUserMsg('Saved!', true);
    } catch (err) {
      setUserMsg(err.code === '23505' ? 'That name is taken — try another.' : 'Could not save name.', false);
    } finally {
      usernameSave.disabled = false;
    }
  }

  async function handleLogin() {
    const api = window.RG_API;
    if (!api) return;

    if (currentAuthTab === 'phone') {
      const rawPhone = phoneInput.value.trim();
      const digits = rawPhone.replace(/\D/g, '');
      if (digits.length < 10) {
        setUserMsg('Enter a valid 10-digit mobile number', false);
        return;
      }
      if (!phoneConsent.checked) {
        setUserMsg('Please agree to SMS terms to continue', false);
        return;
      }
      usernameSave.disabled = true;
      setUserMsg('Sending verification code...', true);
      try {
        const { error } = await api.signInWithPhone(rawPhone);
        if (error) {
          setUserMsg(error.message, false);
          return;
        }
        userRow.classList.add('hidden');
        authTabs.classList.add('hidden');
        phoneConsentRow.classList.add('hidden');
        otpRow.classList.remove('hidden');
        otpInput.value = '';
        otpInput.focus();
        startResendCountdown();
        setUserMsg('Verification code sent via SMS!', true);
      } catch (err) {
        setUserMsg(err.message, false);
      } finally {
        usernameSave.disabled = false;
      }
    } else {
      const email = emailInput.value.trim();
      if (!email.includes('@')) {
        setUserMsg('Enter a valid email', false);
        return;
      }
      usernameSave.disabled = true;
      setUserMsg('Sending login link/code...', true);
      try {
        const { error } = await api.signInWithOtp(email);
        if (error) {
          setUserMsg(error.message, false);
          return;
        }
        userRow.classList.add('hidden');
        authTabs.classList.add('hidden');
        otpRow.classList.remove('hidden');
        otpInput.value = '';
        otpInput.focus();
        startResendCountdown();
        setUserMsg('Check your email for the code or magic link!', true);
      } catch (err) {
        setUserMsg(err.message, false);
      } finally {
        usernameSave.disabled = false;
      }
    }
  }

  async function handleVerify() {
    const api = window.RG_API;
    if (!api) return;
    const token = otpInput.value.trim();
    if (token.length < 6) {
      setUserMsg('Enter 6-digit code', false);
      return;
    }
    otpVerify.disabled = true;
    setUserMsg('Verifying...', true);
    try {
      let res;
      if (currentAuthTab === 'phone') {
        res = await api.verifyPhoneOtp(phoneInput.value, token);
      } else {
        res = await api.verifyOtp(emailInput.value, token);
      }
      if (res.error) {
        setUserMsg(res.error.message, false);
        return;
      }
      if (api.syncUser && (res.data.session || res.data.user)) {
        await api.syncUser(res.data.session || { user: res.data.user });
      }
      clearInterval(resendTimer);
      await setAuthState(res.data.session || { user: res.data.user });
      setUserMsg('Logged in!', true);
    } catch (err) {
      setUserMsg(err.message, false);
    } finally {
      otpVerify.disabled = false;
    }
  }

  async function handleResend() {
    const api = window.RG_API;
    if (!api || resendSeconds > 0) return;
    resendOtpBtn.disabled = true;
    try {
      if (currentAuthTab === 'phone') {
        const { error } = await api.signInWithPhone(phoneInput.value);
        if (error) { setUserMsg(error.message, false); return; }
      } else {
        const { error } = await api.signInWithOtp(emailInput.value);
        if (error) { setUserMsg(error.message, false); return; }
      }
      startResendCountdown();
      setUserMsg('New verification code sent!', true);
    } catch (err) {
      setUserMsg(err.message, false);
    }
  }

  function cancelOtp() {
    clearInterval(resendTimer);
    otpRow.classList.add('hidden');
    userRow.classList.remove('hidden');
    authTabs.classList.remove('hidden');
    if (currentAuthTab === 'phone') {
      phoneConsentRow.classList.remove('hidden');
    }
    setUserMsg('', false);
  }

  async function handleLogout() {
    const api = window.RG_API;
    if (!api) return;
    logoutBtn.disabled = true;
    try {
      await api.signOut();
      setAuthState(null);
      setUserMsg('Logged out', true);
    } catch (err) {
      setUserMsg(err.message, false);
    } finally {
      logoutBtn.disabled = false;
    }
  }

  // Shop rows come from the database; escape text and coerce numbers before
  // building HTML (defense in depth: the catalog is currently admin-written).
  function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  function renderShop() {
    const api = window.RG_API;
    if (!shopItemList || !api) return;
    updateCoinDisplays();
    if (!api.shopCatalog.length) {
      shopItemList.innerHTML = '<div style="text-align:center; opacity:0.6; padding:20px; font-family:ui-monospace,monospace;">No shop items available. Check connection and retry.</div>';
      return;
    }

    const icons = {
      'ROD': '🦯',
      'LINE': '🧵',
      'BAIT': '🪱',
      'REEL': '⚙️',
      'SKIN': '✨'
    };

    shopItemList.innerHTML = api.shopCatalog.map(item => {
      const owned = api.hasUpgrade(item.asset_key);
      const canAfford = api.user && api.coins >= item.cost;
      const icon = icons[item.item_type] || '🎒';

      let btnHtml;
      if (owned) {
        btnHtml = '<button class="shop-buy-btn owned-badge" disabled>OWNED ✓</button>';
      } else if (!api.user) {
        btnHtml = '<button class="shop-buy-btn" disabled title="Login to purchase">LOGIN</button>';
      } else if (canAfford) {
        btnHtml = `<button class="shop-buy-btn" data-id="${num(item.id)}">BUY</button>`;
      } else {
        btnHtml = `<button class="shop-buy-btn" disabled>NEED 🪙</button>`;
      }

      return `
        <div class="shop-card ${owned ? 'owned' : ''}">
          <div class="shop-info">
            <div class="shop-info-top">
              <span class="shop-item-name">${icon} ${esc(item.name)}</span>
              <span class="shop-type-badge">${esc(item.item_type)}</span>
            </div>
            <div class="shop-desc">${esc(item.description || '')}</div>
          </div>
          <div class="shop-action">
            <div class="shop-cost">${num(item.cost)} 🪙</div>
            ${btnHtml}
          </div>
        </div>
      `;
    }).join('');

    shopItemList.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = parseInt(btn.getAttribute('data-id'), 10);
        const item = api.shopCatalog.find(i => i.id === itemId);
        if (!item) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await api.purchaseItem(itemId);
          api.coins -= item.cost;
          api.inventory.add(item.asset_key);
          setShopMsg(`Equipped ${item.name}!`, true);
          if (window.RG_GAME) window.RG_GAME.toast('UNLOCKED ' + item.name.toUpperCase());
          renderShop();
        } catch (err) {
          console.error('Purchase failed', err);
          setShopMsg(err.message || 'Purchase failed', false);
          btn.disabled = false;
          btn.textContent = 'BUY';
        }
      });
    });
  }

  async function openShop() {
    setShopMsg('', false);
    shopOverlay.classList.remove('hidden');
    if (window.RG_API) {
      await window.RG_API.loadShopCatalog();
      await window.RG_API.loadPlayerData();
    }
    renderShop();
  }

  function closeShop() {
    shopOverlay.classList.add('hidden');
  }

  // Hook game events
  function hookGame() {
    if (window.RG_GAME) {
      window.RG_GAME.onGameOver = (summary, earnedCoins) => {
        rulesBlock.classList.add('hidden');
        finalStats.classList.remove('hidden');
        if (window.RG_API && window.RG_API.user) {
          window.RG_API.coins += earnedCoins;
          updateCoinDisplays();
        }
        finalStats.innerHTML =
          `FINAL SCORE <em>${num(summary.score)}</em> &middot; +${num(earnedCoins)} 🪙<br>` +
          `LONGEST DRIVE <em>${Math.round(summary.bestDist)} yd</em><br>` +
          `FISH LANDED <em>${num(summary.fishCaught)}</em>`;
        startBtn.textContent = 'PLAY AGAIN';
        overlay.classList.remove('hidden');
      };
    } else {
      setTimeout(hookGame, 50);
    }
  }
  hookGame();

  startBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    if (window.RG_GAME) window.RG_GAME.newRound();
  });

  if (shopBtn) shopBtn.addEventListener('click', openShop);
  if (openShopLink) openShopLink.addEventListener('click', openShop);
  if (shopCloseBtn) shopCloseBtn.addEventListener('click', closeShop);

  authTabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchAuthTab(btn.dataset.tab));
  });

  phoneInput.addEventListener('input', () => {
    const val = phoneInput.value;
    if (val.startsWith('+')) return;
    let digits = val.replace(/\D/g, '');
    if (digits.length > 10 && digits.startsWith('1')) {
      digits = digits.slice(1);
    }
    digits = digits.slice(0, 10);
    if (digits.length === 0) {
      phoneInput.value = '';
    } else if (digits.length <= 3) {
      phoneInput.value = `(${digits}`;
    } else if (digits.length <= 6) {
      phoneInput.value = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else {
      phoneInput.value = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
  });

  otpInput.addEventListener('input', () => {
    const digits = otpInput.value.replace(/\D/g, '').slice(0, 6);
    otpInput.value = digits;
    if (digits.length === 6) {
      handleVerify();
    }
  });

  usernameSave.addEventListener('click', () => {
    if (usernameSave.textContent === 'LOGIN') handleLogin();
    else saveUsername();
  });

  [usernameInput, phoneInput, emailInput].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (usernameSave.textContent === 'LOGIN') handleLogin();
        else saveUsername();
      }
    });
  });

  otpInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleVerify();
  });

  resendOtpBtn.addEventListener('click', handleResend);
  cancelOtpBtn.addEventListener('click', cancelOtp);
  logoutBtn.addEventListener('click', handleLogout);
  otpVerify.addEventListener('click', handleVerify);

  // Initial tab setup
  switchAuthTab(currentAuthTab);

  // Initialize API auth & catalog
  if (window.RG_API) {
    window.RG_API.loadShopCatalog();
    window.RG_API.initAuth(setAuthState);
  }
})();
