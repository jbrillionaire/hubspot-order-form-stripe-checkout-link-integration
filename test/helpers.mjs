/**
 * helpers.mjs -- fake browser and fake timers for the tests
 * ---------------------------------------------------------
 * Author:  Jibril Sulaiman
 * Created: 2026-09-28
 * Deploy:  Local only. Run the suite with: npm test
 * What:    A cookie jar, a document/window/location stand-in, a minimal DOM for
 *          the order module, and manual timers, so the browser scripts run
 *          unchanged in Node with no dependencies.
 * Why:     The failures that matter here are silent (UTMs that vanish at
 *          Stripe, two campaigns blended into one, a return trip erasing click
 *          ids), so each is pinned by a test.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

export function cookieJar(initial = {}) {
  const jar = new Map(Object.entries(initial));
  const writes = [];
  return {
    jar, writes,
    get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(s) {
      writes.push(s);
      const [kv, ...attrs] = s.split(';');
      const i = kv.indexOf('=');
      const name = kv.slice(0, i).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => a.startsWith('max-age='));
      if (maxAge && Number(maxAge.slice(8)) <= 0) jar.delete(name);
      else jar.set(name, kv.slice(i + 1));
    },
  };
}

export const enc = (obj) => encodeURIComponent(JSON.stringify(obj));
export const dec = (jar, name) => (jar.jar.has(name) ? JSON.parse(decodeURIComponent(jar.jar.get(name))) : null);

export function timers(now = Date.parse('2026-09-28T15:00:00Z')) {
  let t = now, seq = 0;
  const queue = [];
  const api = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; queue.push({ id, at: t + (ms || 0), fn, every: 0 }); return id; },
    setInterval: (fn, ms) => { const id = ++seq; queue.push({ id, at: t + ms, fn, every: ms }); return id; },
    clearTimeout: (id) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > end) break;
        t = next.at;
        if (next.every) next.at += next.every; else queue.shift();
        next.fn();
      }
      t = end;
    },
  };
  api.clearInterval = api.clearTimeout;
  return api;
}

/** Runs a browser script (the header HTML or module.js) against a fake page. */
export function runBrowserScript(source, { url, referrer = '', cookies = {}, dom = null, clock = timers() }) {
  const jar = cookieJar(cookies);
  const location = { href: url, protocol: new URL(url).protocol, origin: new URL(url).origin, pathname: new URL(url).pathname };
  const listeners = {};
  const window = {
    location,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    open: () => null,
  };
  const document = {
    get cookie() { return jar.cookie; },
    set cookie(v) { jar.cookie = v; },
    referrer,
    readyState: 'complete',
    addEventListener: () => {},
    querySelectorAll: (sel) => (dom && sel === '.eof' ? [dom.root] : []),
  };
  class FixedDate extends Date {
    constructor(...a) { super(...(a.length ? a : [clock.now()])); }
    static now() { return clock.now(); }
  }
  const ctx = {
    window, document, location, URL, Date: FixedDate, JSON, Object, String, RegExp, encodeURIComponent, decodeURIComponent,
    setTimeout: clock.setTimeout, setInterval: clock.setInterval, clearTimeout: clock.clearTimeout, clearInterval: clock.clearInterval,
  };
  vm.createContext(ctx);
  vm.runInContext(source.replace(/<\/?script>/g, ''), ctx);
  return { window, document, jar, clock, listeners };
}

/** Minimal DOM for one .eof order module. */
export function orderDom(attrs, { email = 'buyer@example.com', fieldsPresent = true } = {}) {
  const classes = new Set(['eof']);
  const tabs = [{ className: 'eof__tab eof__tab--current' }, { className: 'eof__tab eof__tab--locked' }];
  const notice = { hidden: false };
  const payBtn = { hidden: true, href: '', setAttribute(k, v) { this[k] = v; } };
  const submit = { tagName: 'INPUT', value: 'Submit' };
  const emailInput = { value: email };
  const panel = {
    fields: fieldsPresent,
    querySelector(sel) {
      if (sel.startsWith('input:not')) return this.fields ? {} : null;
      if (sel.includes('type="submit"')) return this.fields ? submit : null;
      return null;
    },
  };
  const root = {
    getAttribute: (n) => (n in attrs ? String(attrs[n]) : null),
    classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) },
    querySelectorAll: (sel) => (sel === '.eof__tab' ? tabs : []),
    querySelector: (sel) => ({ '.eof__panel': panel, '.eof__redirect': notice, '.eof-pay-button': payBtn }[sel]
      || (sel.includes('type="email"') ? emailInput : null)),
    addEventListener: () => {},
  };
  return { root, panel, tabs, notice, payBtn, submit, classes };
}
