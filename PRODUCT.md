# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Electron desktop application with a Next.js and TypeScript renderer and Tailwind CSS. This stack is required by the product brief. Supporting libraries should stay intentional.

## Users

Visual creators who use Google Flow to develop recurring characters and make images and videos. They need to carry references, prompts, settings, and asset history through repeated creation sessions.

## Product Purpose

Clips is a local-first studio for creating and organizing characters, images, videos, and references. Google Flow supplies generation; Clips owns the workflow and the user's local library.

## Positioning

Clips keeps generated work and its relationships in one account-independent library. A user can generate with one Google account, switch accounts, and continue using the same locally owned assets.

## Operating Context

Clips runs as a desktop application on Windows, macOS, and Linux. A typical session starts with a reusable character or reference, creates image candidates, and carries chosen work into video generation. Jobs should survive navigation and application restarts. Library work must remain available without a connected provider account.

## Capabilities and Constraints

- English and German are required, with locale files and a reliable fallback to English.
- The provider boundary must expose current capabilities so the interface does not offer unsupported model options.
- A complete mock provider is required for ordinary development and testing; mock work must never spend Google Flow credits.
- Account changes must not move or delete Clips-owned files.
- Do not silently substitute the Gemini API for Google Flow. Google's Gemini API has its own programmatic models and access path; the product brief names Google Flow accounts and credits as the provider experience.
- Do not cycle accounts to work around limits or consume credits without an explicit generation action.

## Brand Commitments

- The product is named Clips.
- The requested interface is restrained and cinematic, using black, white, and neutral grays, with strong typography and purposeful motion.
- User-facing writing is concise, specific, and natural.
- Copyright is © 2026 Nikita Berger. The project uses Apache License 2.0.
- The supplied recording is interaction inspiration. Do not reproduce its branding or the unrelated window visible at its beginning.

## Evidence on Hand

- The user supplied a detailed product and engineering brief.
- The user supplied a short desktop recording. It shows a persistent prompt area beside a dense image-candidate workspace; the opening window is incidental.
- No production logo, user media library, testimonials, or real Flow credentials were supplied. Do not invent endorsements or account/credit data.

## Product Principles

1. A user's work belongs to Clips and remains useful when accounts change.
2. Keep the path from character to image to video direct, with references and provenance visible when they help.
3. Preserve prompts and references when jobs fail or the provider is unavailable.
4. Make costs and unsupported options clear before generation.
5. Make mock development realistic while using zero Google Flow credits.

## Accessibility & Inclusion

Support keyboard-only use, visible focus, clear labels, useful screen-reader names, reduced motion, readable contrast, and layouts that remain usable at narrow window widths. German copy must fit without clipping.
