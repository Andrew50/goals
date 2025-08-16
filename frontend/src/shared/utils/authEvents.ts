export type ForceLogoutEvent = Event;

const FORCE_LOGOUT_EVENT = 'app:force-logout';

export function forceLogout(): void {
    window.dispatchEvent(new Event(FORCE_LOGOUT_EVENT));
}

export function onForceLogout(callback: () => void): () => void {
    const handler = () => callback();
    window.addEventListener(FORCE_LOGOUT_EVENT, handler);
    return () => window.removeEventListener(FORCE_LOGOUT_EVENT, handler);
}


