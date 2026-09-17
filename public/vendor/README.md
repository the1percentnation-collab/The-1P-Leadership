# Vendored third-party browser bundles

This project has no bundler — modules are loaded straight from `public/js/` as
ES modules, and Firebase comes from the gstatic CDN. Libraries that only ship
as npm packages are vendored here as prebuilt browser bundles instead of being
loaded from a public CDN, so an outage or a tampered CDN cannot take the CRM
down or inject script into an authenticated admin page.

## twilio-voice-2.18.5.min.js

The Twilio Voice JS SDK, used by `js/dialer-core.js` for the browser softphone.
It is `dist/twilio.min.js` from the npm package, copied verbatim. The bundle
checks for an AMD loader first and otherwise assigns `window.Twilio.Device` /
`window.Twilio.Call`, which is what `dialer-core.js` waits for. There is no ESM
entry point that works without a bundler, which is why this file is vendored
rather than imported.

To upgrade, bump the version in the filename and in `dialer-core.js`'s
`SDK_SRC`, then:

    npm pack @twilio/voice-sdk@<version>
    tar xzf twilio-voice-sdk-<version>.tgz package/dist/twilio.min.js
    cp package/dist/twilio.min.js public/vendor/twilio-voice-<version>.min.js

Keeping the version in the filename means a stale browser cache can never
serve a half-upgraded SDK.

## telnyx-webrtc-2.27.10.min.mjs

The Telnyx WebRTC SDK, used by `js/dialer-core.js` for the browser softphone.
It is `lib/bundle.mjs` from the npm package, copied verbatim. Unlike the Twilio
bundle this one is a self-contained ES module — no bare imports, no Node
builtins — so `dialer-core.js` loads it with a plain dynamic `import()` and
reads the `TelnyxRTC` export. No globals, no script tag.

To upgrade, bump the version in the filename and in `dialer-core.js`'s
`SDK_SRC`, then:

    npm pack @telnyx/webrtc@<version>
    tar xzf telnyx-webrtc-<version>.tgz package/lib/bundle.mjs
    cp package/lib/bundle.mjs public/vendor/telnyx-webrtc-<version>.min.mjs

Check after upgrading that the bundle still has no top-level `import` of a bare
specifier, since that would need a bundler:

    grep -o '^import[^;]*;' public/vendor/telnyx-webrtc-<version>.min.mjs
