/** Viewer's colour theme. "system" follows the operating system setting. */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_STORAGE_KEY = "agentplanner-theme";

/**
 * Runs in <head> before the first paint, so a stored light or dark choice
 * applies without a flash. Storage can throw in private windows; then the
 * system setting applies.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
