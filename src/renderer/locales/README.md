# Bundled UI language packs

The six additional JSON dictionaries were generated from application-owned UI catalogue text on
2026-09-08 using Google Translate, then reviewed for key navigation and task-action terminology.
They have not received comprehensive native-speaker review. They contain no session content,
credentials or user paths. Translation is an authoring step; the app never calls a translation
service at runtime.

English and Simplified Chinese remain in the existing i18n modules. `TRANSLATION_KEYS` is the union
of their source strings. `locale-coverage.test.ts` rejects missing entries, empty labels, leaked
batch markers and changed placeholder names/counts. Keep placeholders and protocol identifiers
unchanged when editing. Native language names come from `shared/languages.ts`.
