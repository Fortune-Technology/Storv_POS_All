import React, { useEffect, useCallback } from 'react';
import introJs from 'intro.js';
import 'intro.js/introjs.css';
import './OnboardingTour.css';

// Description copy per sidebar group label. Keep in sync with the
// `menuGroups` array in Sidebar.jsx — groups not listed here fall back
// to a generic description so new groups still show up in the tour.
const GROUP_COPY = {
  'Operations':         'Live dashboard, team chat, and tasks — the day-to-day pulse of your store.',
  'Customers':          'Manage customer profiles, loyalty programs, and store credit.',
  'Lottery':            'Scratch-ticket inventory, sales, and end-of-day reconciliation.',
  'Fuel':               'Fuel grades, pump sales, and per-type reports.',
  'Catalog':            'Products, departments, promotions, bulk import, and inventory counts.',
  'Vendors':            'Vendors, payouts, auto-orders, invoice OCR, and CSV transforms.',
  'Reports & Analytics':'Transactions, sales analytics, employee hours, audit logs, and end-of-day reports.',
  'Online Store':       'Your ecommerce storefront — setup, live orders, and online analytics.',
  'StoreVeu Exchange':  'B2B wholesale between StoreVeu stores.',
  'Integrations':       'Third-party delivery platforms and external integrations.',
  'Point of Sale':      'POS layout, Quick Buttons, tax and fee rules.',
  'Support & Billing':  'Open support tickets and manage your subscription.',
  'Account':            'Organization, users, roles, stores, and invitations.',
};

const STORAGE_PREFIX = 'storv-sidebar-onboarding-seen:';

function storageKey() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return u?.id ? `${STORAGE_PREFIX}${u.id}` : null;
  } catch { return null; }
}

/**
 * Build intro.js steps from the visible sidebar.
 * Generated from DOM (not config) so it always reflects what THIS user
 * can actually see after RBAC + module filtering.
 */
function buildSteps() {
  const steps = [];

  // Welcome — floating tooltip (no target element → centered, no highlight
  // overlapping the card).
  steps.push({
    intro:
      '<strong>Welcome to StoreVeu!</strong><br/>' +
      'Take a quick tour of the sidebar. You can exit anytime and restart from the <em>Help · Take the tour</em> button below the logo.',
  });

  // One step per visible nav-group
  const groups = document.querySelectorAll('.sidebar .nav-group');
  groups.forEach((groupEl) => {
    const labelEl = groupEl.querySelector('.nav-group-label');
    const label = labelEl?.textContent?.trim() || '';
    const itemNames = Array.from(groupEl.querySelectorAll('.nav-link .nav-text'))
      .map(n => n.textContent.trim())
      .filter(Boolean);
    if (!itemNames.length) return;

    const copy = GROUP_COPY[label] || `Tools for ${label.toLowerCase()}.`;
    const itemList = itemNames.map(n => `<li>${n}</li>`).join('');
    steps.push({
      element: groupEl,
      intro:
        `<strong>${label}</strong><br/>${copy}` +
        `<ul class="otr-item-list">${itemList}</ul>`,
      position: 'right',
    });
  });

  // Help button
  const helpBtn = document.querySelector('[data-tour="sidebar-help-btn"]');
  if (helpBtn) {
    steps.push({
      element: helpBtn,
      intro:
        '<strong>Need this again?</strong><br/>' +
        'Click <em>Take the tour</em> any time to restart the onboarding walkthrough.',
      position: 'right',
    });
  }

  // Profile card
  const userCard = document.querySelector('.sidebar-user-card');
  if (userCard) {
    steps.push({
      element: userCard,
      intro:
        '<strong>Your profile</strong><br/>' +
        'See who you are signed in as and update your name, phone, or password from here.',
      position: 'right',
    });
  }

  return steps;
}

function runTour() {
  // Clean up any previously-rendered intro.js elements from a prior tour
  // run so we never end up with two tooltips on screen at once.
  document.querySelectorAll(
    '.introjs-overlay, .introjs-helperLayer, .introjs-tooltipReferenceLayer, .introjs-tooltip, .introjs-fixParent'
  ).forEach((el) => el.remove());

  const steps = buildSteps();
  if (!steps.length) return;

  const intro = introJs.tour();
  intro.setOptions({
    steps,
    showProgress: true,
    showBullets: false,
    exitOnEsc: true,
    exitOnOverlayClick: true,
    disableInteraction: false,
    scrollToElement: true,
    scrollPadding: 40,
    nextLabel: 'Next →',
    prevLabel: '← Back',
    doneLabel: 'Finish',
    skipLabel: 'Skip',
    tooltipClass: 'otr-tooltip',
    highlightClass: 'otr-highlight',
    scrollTo: 'off',
  });

  // Scroll the sidebar (not the page) so the highlighted group is in view,
  // then refresh intro.js so the highlight + tooltip reposition correctly.
  const scrollTargetIntoView = (el) => {
    if (!el) return;
    const aside = el.closest('.sidebar');
    if (aside) {
      const eTop = el.offsetTop;
      const eBottom = eTop + el.offsetHeight;
      const vTop = aside.scrollTop;
      const vBottom = vTop + aside.clientHeight;
      const pad = 24;
      if (eTop < vTop + pad) {
        aside.scrollTop = Math.max(0, eTop - pad);
      } else if (eBottom > vBottom - pad) {
        aside.scrollTop = eBottom - aside.clientHeight + pad;
      }
    } else {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  };

  // Scroll the sidebar synchronously BEFORE intro.js measures the next
  // step's target. Returning `true` keeps onbeforechange non-blocking
  // (intro.js 8 doesn't reliably await a Promise return value).
  intro.onbeforechange(function (targetEl) {
    scrollTargetIntoView(targetEl);
    return true;
  });
  // After intro.js paints, re-measure a few times so the helper lands
  // exactly on the target even if the sidebar is mid-animation.
  intro.onafterchange(function () {
    [40, 160, 320].forEach((ms) => {
      setTimeout(() => { try { intro.refresh(); } catch {} }, ms);
    });
  });

  // Also reposition on window resize / sidebar scroll while a step is active.
  const onReposition = () => { try { intro.refresh(); } catch {} };
  window.addEventListener('resize', onReposition);
  const aside = document.querySelector('.sidebar');
  aside?.addEventListener('scroll', onReposition, { passive: true });
  const cleanup = () => {
    window.removeEventListener('resize', onReposition);
    aside?.removeEventListener('scroll', onReposition);
  };

  const markSeen = () => {
    const key = storageKey();
    if (key) localStorage.setItem(key, '1');
  };
  intro.oncomplete(() => { markSeen(); cleanup(); });
  intro.onexit(() => { markSeen(); cleanup(); });
  intro.start();
}

/**
 * Global onboarding controller.
 * - Auto-starts on first mount for a given user (gated by localStorage).
 * - Listens for `storv-start-onboarding` window event to allow manual replay.
 */
const OnboardingTour = () => {
  const start = useCallback(() => {
    // Close mobile drawer if open, then wait a tick for DOM paint.
    setTimeout(runTour, 150);
  }, []);

  // Manual trigger via event
  useEffect(() => {
    const handler = () => start();
    window.addEventListener('storv-start-onboarding', handler);
    return () => window.removeEventListener('storv-start-onboarding', handler);
  }, [start]);

  // First-visit auto-start
  useEffect(() => {
    const key = storageKey();
    if (!key) return;                // no user, skip
    if (localStorage.getItem(key)) return; // already seen
    // Wait for sidebar to paint
    const t = setTimeout(() => {
      if (document.querySelector('.sidebar .nav-group')) start();
    }, 800);
    return () => clearTimeout(t);
  }, [start]);

  return null;
};

export default OnboardingTour;
