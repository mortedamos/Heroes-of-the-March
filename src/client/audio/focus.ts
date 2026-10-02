/** Whether the page is in the foreground: all sound is silenced while it isn't. */
export function inFocus(): boolean {
  return !document.hidden && document.hasFocus();
}

/** Calls `fn(focused)` whenever the page gains or loses focus or visibility. */
export function onFocusChange(fn: (focused: boolean) => void): void {
  const update = (): void => fn(inFocus());
  window.addEventListener('blur', update);
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', update);
}
