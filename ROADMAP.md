# Roadmap

This roadmap describes the next production-readiness goals for DB Backup CLI.

## Current Priority

### 1. Stabilize the package release path

- Verify the npm package entrypoint and published binary
- Keep GitHub release and npm publish automation aligned
- Ensure release artifacts are reproducible

### 2. Expand automated testing coverage

- Add deterministic unit tests for command registration and helpers
- Add integration tests for the service stack and CLI flows
- Add mock database and storage tests for offline verification

### 3. Harden CI/CD

- Keep lint, type check, and build required on pull requests
- Preserve artifact uploads for troubleshooting
- Keep CodeQL and Dependabot active

### 4. Improve documentation

- Keep README, support, security, and contributing docs in sync with the codebase
- Add release notes and changelog discipline
- Document operational and troubleshooting workflows more completely

## Near-Term Goals

- Improve test isolation and fixtures
- Add more edge-case coverage for restore and backup flows
- Reduce reliance on manual smoke testing
- Document environment and storage setup for contributors

## Later Goals

- Broader storage provider support
- More observability and health reporting
- Release provenance and signing improvements
- Better end-user diagnostics for failed backups and restores
