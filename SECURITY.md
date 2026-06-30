# Security Policy

## Supported Versions

Security fixes are expected to be applied to the current main branch and the latest released package version.

## Reporting a Vulnerability

If you discover a security issue, do not open a public issue. Report it privately with:

- A short description of the issue
- Affected command, module, or workflow
- Steps to reproduce
- Any proof-of-concept details
- Suggested severity if known

If the issue involves exposed credentials, unsafe defaults, supply-chain risk, or data loss, please include that in the report.

## Security Expectations for Contributors

- Never commit real secrets, tokens, or personal credentials.
- Keep test fixtures and examples free of production data.
- Prefer least-privilege service credentials.
- Treat backup files, logs, and metadata as sensitive artifacts.
- Validate input passed to CLI commands, environment variables, and webhook endpoints.

## Dependency Hygiene

This repository uses automated dependency and security scanning. When updating dependencies:

- Review changelogs for breaking changes
- Prefer minimal version bumps
- Verify the build and tests still pass
- Check for new runtime permissions or native module requirements

## Workflow Security

- Release automation should be tag-driven.
- Publishing should require explicit npm credentials.
- Code scanning should remain enabled for pull requests and main-branch updates.
