# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-05-29

### Added
- Initial public release
- `MaildenoClient` with `render()`, `renderHtml()`, `renderReact()`, `renderMjml()`
- Full TypeScript types exported from package root
- Structured `MaildenoError` with `code`, `status`, and `issues`
- Dual CJS/ESM build via `tsup`
- Vitest test suite with full error-path coverage