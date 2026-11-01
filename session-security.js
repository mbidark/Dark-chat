export const INACTIVE_LOGOUT_MS = 30 * 60 * 1000;
const ACTIVITY_KEY = 'darkchat_last_activity';

export function markSessionActive() {
  localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

export function hasSessionExpired(now = Date.now()) {
  const raw = localStorage.getItem(ACTIVITY_KEY);
  if (!raw) return false;
  const lastActivity = Number(raw);
  return Number.isFinite(lastActivity) && now - lastActivity >= INACTIVE_LOGOUT_MS;
}

export function startInactiveLogout(onLogout) {
  markSessionActive();
  const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
  let intervalId = null;

  const activity = () => {
    markSessionActive();
  };

  for (const eventName of events) {
    window.addEventListener(eventName, activity, { passive: true });
  }

  const check = () => {
    if (hasSessionExpired()) onLogout();
  };
  intervalId = window.setInterval(check, 15 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });

  return () => {
    for (const eventName of events) {
      window.removeEventListener(eventName, activity);
    }
    window.clearInterval(intervalId);
  };
}
