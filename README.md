# Clips

Clips is a local-first desktop studio for building characters and creating, reusing, and organizing images and videos. Google Flow handles live generation; your prompts, references, and library belong to Clips and remain on your computer.

## Development

Install the dependencies, then start the desktop app:

```sh
npm install
npm run dev
```

The project uses Electron, Next.js, TypeScript, and Tailwind CSS.

## Google Flow

Use the built-in mock provider for development and tests. It creates local sample jobs and does not use Google Flow credits. Live generation is a deliberate, manual action in Google Flow: sign in there, start generation there, then bring the result into Clips. Clips does not call private Flow endpoints, scrape browser cookies, or silently substitute the Gemini API. A live generation started in Flow may use Google's credits.

## Local data

Clips stores its database and media in the operating system's per-user application-data directory, separately from the repository and independent of the connected Google account. Use the app's storage controls to locate that directory.

## Tests and packaging

```sh
npm test
npm run test:e2e
npm run typecheck
npm run package
```

`npm run test:e2e` builds the Electron bridge, starts the local renderer, and checks the first-run desktop flow in an isolated temporary profile. Ordinary tests use the mock provider and are quota-safe. Packaging is configured for Windows, macOS, and Linux; platform signing and distribution requirements vary by release environment.

## Contributing

Bug reports and focused pull requests are welcome. Please run the tests and type check before submitting changes, and include steps to reproduce user-facing issues.

## License

Clips is available under the Apache License 2.0. See [LICENSE](LICENSE). Copyright © 2026 Nikita Berger.
