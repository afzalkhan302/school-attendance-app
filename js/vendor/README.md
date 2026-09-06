# Vendored libraries

## xlsx.full.min.js — SheetJS Community Edition 0.20.3

Reads `.xlsx` and `.xls` for the student import. Vendored rather than pulled
from npm or a CDN for two reasons: the app must parse spreadsheets with no
network inside the APK, and the npm `xlsx` package stopped at 0.18.5, which
carries CVE-2023-30533 (prototype pollution in the parser). SheetJS moved
distribution to their own CDN; 0.20.3 is past that and past CVE-2024-22363.

Source:  https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz  (dist/xlsx.full.min.js)
Licence: Apache-2.0

It is **not** loaded at startup — `js/import.js` injects it the first time a
teacher opens the import screen, so it costs nothing on the boot path.

To refresh:

    npm install --no-save https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz
    cp node_modules/xlsx/dist/xlsx.full.min.js js/vendor/xlsx.full.min.js

## firebase-{app,auth,firestore}-compat.js — Firebase JS SDK 12.18.0

Cloud accounts and cross-device sync. The *compat* bundles are used rather than
the modular SDK because this app has no bundler: each file defines its global
and they load with plain script tags, exactly as SheetJS does.

Source:  npm `firebase@12.18.0`  (firebase-app-compat.js, firebase-auth-compat.js,
         firebase-firestore-compat.js from the package root)
Licence: Apache-2.0

Loaded lazily by `js/cloud.js`, and only when `js/firebase-config.js` has been
filled in. An unconfigured app never fetches or parses them.
