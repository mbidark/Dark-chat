export const INACTIVE_LOGOUT_MS = 30 * 60 * 1000;

function activityKey(role) {
  return `darkchat_last_activity_${role === 'owner' ? 'owner' : 'visitor'}`;
}

export function markSessionActive(role = 'visitor') {
  localStorage.setItem(activityKey(role), String(Date.now()));
}

export function hasSessionExpired(now = Date.now(), role = 'visitor') {
  const raw = localStorage.getItem(activityKey(role));
  if (!raw) return false;
  const lastActivity = Number(raw);
  return Number.isFinite(lastActivity) && now - lastActivity >= INACTIVE_LOGOUT_MS;
}

export function startInactiveLogout(onLogout, role = 'visitor') {
  markSessionActive(role);
  const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
  let intervalId = null;

  const activity = () => {
    markSessionActive(role);
  };

  for (const eventName of events) {
    window.addEventListener(eventName, activity, { passive: true });
  }

  let logoutStarted = false;
  const check = () => {
    if (!logoutStarted && hasSessionExpired(Date.now(), role)) {
      logoutStarted = true;
      onLogout();
    }
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
