# Clips

Clips is a local-first desktop studio for creating images and videos, reusing reference images, organizing a media library, and keeping prompts with their results. Installed releases start with an empty library and do not include development sample media.

## Run in development

Install the dependencies and start the desktop app:

```sh
npm install
npm run dev
```

Development starts with a local test provider and a ready-to-explore sample library with fictional image and video references plus the Mara character. Local mock generations use repository fixtures and do not use a Google account or Flow credits. To test the live provider in development, set `CLIPS_PROVIDER=google-flow` before `npm run dev`; live-provider profiles stay empty until you import media.

## Connect Google Flow

Clips uses the open-source [gflow-cli](https://github.com/ffroliva/gflow-cli) connector. You do not need to install it separately: after reviewing and accepting the required first-run notice, choose **Continue with Google** in Clips. In development, Clips downloads the pinned runtime after you choose Google sign-in. The Windows installer downloads and prepares the pinned `uv`, gflow-cli, managed Python, and Chromium runtime in the current user's Clips data folder during installation, so first sign-in can open the private Google sign-in browser without waiting for a runtime setup. Windows setup requires an internet connection; it verifies the downloaded `uv` binary before use. macOS and Linux installers bundle the same verified runtime and Clips prepares its writable per-user copy when the app first opens. No system-wide tools are installed.

Each Google account gets a separate gflow-cli profile. Add accounts from Clips’ Accounts page, choose which one is active, or sign out; sign-out deletes that profile’s saved browser session and Clips requires a new Google sign-in before using it again. The login browser opens Google sign-in directly and redirects to Flow after authentication. Clips never reads or stores your Google password, cookies, or session token. Generations are started from Clips and their output files are imported into the Clips library. Development mode can use the local mock provider and sample media without signing in; packaged releases contain neither sample media nor the development provider.

The connector is unofficial, alpha, and reverse-engineered; it is not affiliated with Google, and Flow changes may break it. Its `gflow models --json` catalog supplies the model aliases, accepted aspect ratios, and reference-image limits shown in Clips. Video generation may use Flow credits from your account. Review the connector’s [disclaimer](https://github.com/ffroliva/gflow-cli/blob/main/DISCLAIMER.md) and Google’s terms before connecting.

The managed connector runtime, Python environment, browser, profile, and cache stay under Clips' per-user application-data directory. Removing that folder removes this managed runtime and local data. Development builds require the system `tar` utility to unpack the first-use runtime download.

## Local data

Clips stores its database and media in the operating system’s per-user application-data directory, separately from the repository. Use **Settings → Open data folder** to locate it. Imported and generated media are copied into this library.

## Checks and packaging

```sh
npm test
npm run lint
npm run typecheck
npm run test:e2e
npm run package:win
npm run test:package
npm run generate:icons
```

The app uses Lucide icons through `lucide-react`; its Clapperboard mark is used for the app icon. Run `npm run generate:icons` to rebuild the platform icon assets from the pack icon. The Manrope variable font is bundled under the SIL Open Font License 1.1; its notice is included with the application. The automated tests use the local test provider and do not sign in or spend Flow credits. `npm run test:package` expects a platform package to have been built first.

## Contributing

Bug reports and focused pull requests are welcome. Please run the tests and type check before submitting changes, and include steps to reproduce user-facing issues.

## License

Clips is available under the Apache License 2.0. See [LICENSE](LICENSE). Copyright © 2026 Nikita Berger.
