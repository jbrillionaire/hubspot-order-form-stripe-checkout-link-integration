/*
  module.js -- Order Form (Stripe): step 1 HubSpot form, step 2 Stripe Payment Link
  ----------------------------------------------------------------------------
  Author:  Jibril Sulaiman
  Created: 2026-09-28 (from a production build first shipped 2026-09-04)
  Deploy:  HubSpot Design Manager > your "Order Form (Stripe)" module > module.js.
           Set COOKIE_NAME to match site-header/utm-capture.html.

  What it does:
    Shows a HubSpot form as step 1. When the form submits, it sends the buyer
    to the Stripe Payment Link (step 2) with:
      - the campaign UTMs captured earlier in the visit (site_attr cookie), or
        the order page's own URL params if it was opened with them,
      - ad click ids and Meta's fbc/fbp, for server-side conversion events,
      - prefilled_email, so the Stripe payment matches the HubSpot contact.
    Stripe copies the UTMs into the Checkout Session's success_url, where the
    workflow action in /workflow-action reads them back onto the payment record.

  Why it's built this way:
    - Submit is detected by the form's fields disappearing from the panel,
      checked by a MutationObserver plus a 300 ms poll. HubSpot's form events
      don't fire reliably across the legacy and new form frameworks, so they're
      listened to as well but never relied on.
    - The redirect code never depends on the button-label code. The label is
      re-applied for 3 s after submit (HubSpot resets it by property write,
      which no observer sees); if that breaks, checkout still works.
    - Back button / bfcache / reload after submitting shows a real "Continue to
      payment" button instead of a stuck "Redirecting..." line.

  Stripe's rules (docs.stripe.com/payment-links/url-parameters):
    Only utm_source, utm_medium, utm_campaign, utm_content and utm_term are
    carried into the success URL. Values must be letters, digits, "-" or "_",
    at most 150 characters; anything else is dropped SILENTLY. Meta campaign
    names ("Brand | Sep | Prospecting") therefore vanish unless flattened, so
    UTM values are cleaned below. The cookie keeps the original value.
    Click ids and fbc/fbp are NOT documented to pass through to the success URL.
    They're forwarded as-is (never truncated: a truncated click id matches
    nothing while looking present) for anything that reads the Stripe checkout
    URL or session. Verify with your own test purchase before relying on them.
*/
(function () {
  var COOKIE_NAME = 'site_attr';   // <-- must match the site header script

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CLICK_IDS = [
    'gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid', 'ttclid',
    'twclid', 'li_fat_id', 'irclickid', 'epik', 'sccid', 'rdt_cid'
  ];
  // Raw fbclid is not sent: Meta matches on fbc (fb.1.<ms>.<fbclid>), which contains it.
  var OUTBOUND_SKIP = ['fbclid'];

  function isTracking(key) {
    var k = String(key).toLowerCase();
    return /^utm_/.test(k) || /^hsa_/.test(k) || CLICK_IDS.indexOf(k) !== -1;
  }

  // Stripe's documented UTM rule: [A-Za-z0-9_-], max 150.
  function stripeUtm(value) {
    return String(value)
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 150);
  }

  function cookieValue(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) {
      return '';
    }
  }

  function readStored() {
    try {
      var raw = cookieValue(COOKIE_NAME);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
      return {};
    }
  }

  function pageParams() {
    var out = {};
    try {
      new URL(window.location.href).searchParams.forEach(function (value, key) {
        if (value && isTracking(key)) out[key] = value;
      });
    } catch (e) {}
    return out;
  }

  // Stripe hands back the CLEANED value (Brand-Sep-2026) for a stored raw one
  // (Brand | Sep 2026), so equal-after-cleaning counts as the same value.
  function sameValue(a, b) {
    if (a === b) return true;
    var clean = function (v) {
      return String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
    };
    return a != null && b != null && clean(a) !== '' && clean(a) === clean(b);
  }

  // Tracking params on this page's own URL win; otherwise the stash from earlier
  // in the visit. Never a blend of the two (same rule as the header script).
  // Reading only: the header script is the one writer of the cookie.
  function attribution() {
    var onPage = pageParams();
    var stored = readStored();
    var keys = Object.keys(onPage);
    if (!keys.length) return stored;
    // A URL that only repeats what's stored (e.g. a redirect forwarded utm_source)
    // is the same touch: keep the full stash, click ids included.
    for (var i = 0; i < keys.length; i++) if (!sameValue(stored[keys[i]], onPage[keys[i]])) return onPage;
    return stored;
  }

  function metaParams(data) {
    var out = {};
    var fbc = cookieValue('_fbc');                 // written by the Meta pixel
    if (!fbc && data.fbclid) {
      var clickedAt = Date.parse(data._t || '') || Date.now();
      fbc = 'fb.1.' + clickedAt + '.' + data.fbclid;
    }
    if (fbc) out.fbc = fbc;
    var fbp = cookieValue('_fbp');
    if (fbp) out.fbp = fbp;
    return out;
  }

  function outboundParams() {
    var data = attribution();
    var params = {};
    Object.keys(data).forEach(function (k) {
      if (k.charAt(0) === '_') return;              // local audit metadata (_t, _ref, _lp, _inferred)
      if (OUTBOUND_SKIP.indexOf(k) !== -1) return;
      var v = String(data[k] || '');
      if (!v) return;
      if (UTM_KEYS.indexOf(k) !== -1) {
        v = stripeUtm(v);
        if (v) params[k] = v;
      } else {
        params[k] = v;                              // click ids and hsa_*: unaltered
      }
    });
    var meta = metaParams(data);
    Object.keys(meta).forEach(function (k) { params[k] = meta[k]; });
    return params;
  }

  function buildUrl(base, params) {
    if (!base) return '';
    var u;
    try { u = new URL(base, window.location.href); } catch (e) { return base; }
    Object.keys(params).forEach(function (k) { if (params[k]) u.searchParams.set(k, params[k]); });
    return u.toString();
  }

  function paramFromPage(key) {
    try { return new URL(window.location.href).searchParams.get(key) || ''; } catch (e) { return ''; }
  }

  function setup(root) {
    var baseUrl = root.getAttribute('data-stripe-url') || '';
    var prefill = root.getAttribute('data-prefill') === 'true';
    var newTab  = root.getAttribute('data-new-tab') === 'true';
    var label   = root.getAttribute('data-button-label') || '';

    var tabs   = root.querySelectorAll('.eof__tab');
    var panel  = root.querySelector('.eof__panel');
    var notice = root.querySelector('.eof__redirect');
    var payBtn = root.querySelector('.eof-pay-button');
    if (!panel) return;

    var email      = paramFromPage('email');
    var seenForm   = false;
    var done       = false;
    var labelTimer = null;
    var pollTimer  = null;

    function submitButton() {
      return panel.querySelector('input[type="submit"], button[type="submit"], .hs-button.primary');
    }

    function hasFields() {
      return !!panel.querySelector('input:not([type="hidden"]), textarea, select');
    }

    function captureEmail() {
      try {
        var input = root.querySelector('input[type="email"], input[name="email"]');
        if (input && input.value) email = input.value.trim();
      } catch (e) {}
    }

    function payUrl() {
      var params = outboundParams();
      if (prefill && email) params.prefilled_email = email;   // Stripe locks a prefilled email
      return buildUrl(baseUrl, params);
    }

    function showStep2() {
      root.classList.add('eof--step2');
      if (tabs[0]) tabs[0].className = 'eof__tab eof__tab--done';
      if (tabs[1]) tabs[1].className = 'eof__tab eof__tab--current';
    }

    function showFallback() {
      if (!payBtn) return;
      payBtn.setAttribute('href', payUrl() || baseUrl);
      payBtn.hidden = false;
      if (notice) notice.hidden = true;
      showStep2();
    }

    // ---- redirect path (must never depend on the label code) ----

    function go() {
      if (!baseUrl) return;
      var url = payUrl();
      if (!url) return;
      if (newTab) {
        var w = window.open(url, '_blank');
        if (w) { showFallback(); return; }   // popup blocked -> same tab
      }
      window.location.href = url;
      setTimeout(showFallback, 3000);        // navigation didn't happen: surface the button
    }

    function onSubmitted() {
      if (done) return;
      done = true;
      clearInterval(labelTimer);
      clearInterval(pollTimer);
      captureEmail();
      try { showStep2(); } catch (e) {}
      setTimeout(go, 250);
    }

    function checkPanel() {
      if (done) return;
      if (hasFields()) {
        seenForm = true;
        try { applyButtonLabel(); } catch (e) {}
        return;
      }
      if (seenForm) onSubmitted();           // fields vanished after being seen = submitted
    }

    // ---- label path (isolated; failures here are cosmetic only) ----

    function applyButtonLabel() {
      if (!label) return;
      var b = submitButton();
      if (!b) return;
      if (b.tagName === 'INPUT') {
        if (b.value !== label) b.value = label;
      } else if (b.textContent.trim() !== label) {
        b.textContent = label;
      }
    }

    function holdLabel() {
      if (!label) return;
      clearInterval(labelTimer);
      var until = Date.now() + 3000;
      labelTimer = setInterval(function () {
        if (done || Date.now() > until) { clearInterval(labelTimer); return; }
        try { applyButtonLabel(); } catch (e) {}
      }, 50);
    }

    // ---- wiring ----

    if (window.MutationObserver) {
      new MutationObserver(checkPanel).observe(panel, { childList: true, subtree: true });
    }
    pollTimer = setInterval(checkPanel, 300);
    checkPanel();

    // Loaded straight into an already-submitted form (back button, reload).
    setTimeout(function () {
      if (!done && !seenForm && !hasFields() && baseUrl) {
        clearInterval(pollTimer);
        done = true;
        showFallback();
      }
    }, 2500);

    window.addEventListener('pageshow', function (e) {
      if (e.persisted && (done || root.classList.contains('eof--step2'))) showFallback();
    });

    root.addEventListener('input', captureEmail, true);
    root.addEventListener('change', captureEmail, true);
    root.addEventListener('submit', function () { captureEmail(); holdLabel(); }, true);
    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('input[type="submit"], button[type="submit"], .hs-button.primary')) {
        captureEmail();
        holdLabel();
      }
    }, true);

    document.addEventListener('hs-form-event:on-submitted', onSubmitted, true);
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'hsFormCallback' && e.data.eventName === 'onFormSubmitted') onSubmitted();
    });
  }

  function init() {
    var roots = document.querySelectorAll('.eof');
    for (var i = 0; i < roots.length; i++) setup(roots[i]);
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
