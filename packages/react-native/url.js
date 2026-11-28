// React Native's built-in URL implements little beyond href (hostname, pathname and
// port throw "not implemented"); the SDK validates and builds endpoints with URL.
// Install a complete WHATWG URL only when the platform's is incomplete.
import { setupURLPolyfill } from 'react-native-url-polyfill';

function complete() {
  try {
    const url = new URL('https://user@example.invalid:8443/a?b=1#c');
    url.pathname = '/x';
    return url.hostname === 'example.invalid' && url.port === '8443' && url.pathname === '/x'
      && url.username === 'user' && url.search === '?b=1' && url.href.startsWith('https://user@');
  } catch {
    return false;
  }
}

if (!complete()) setupURLPolyfill();
