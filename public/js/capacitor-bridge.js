// Capacitor native context detection and native-specific helpers.
// Safe to import in web context — all guards check window.Capacitor first.

export const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform());

export function getPlatform() {
  if (!window.Capacitor) return 'web';
  return window.Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
}

// Open a URL in the system browser rather than navigating the WebView away.
// In web context, falls back to window.open.
export async function openExternalUrl(url) {
  if (isNative) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

// Mark <html> with .is-native so CSS can hide web-only UI elements.
if (isNative) {
  document.documentElement.classList.add('is-native');
}
