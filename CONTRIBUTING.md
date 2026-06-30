# Contributing to DB Backup CLI

Thank you for your interest in contributing.

This repository is organized as a TypeScript CLI and microservice-backed backup system. Contributions are welcome as long as they are focused, well tested, and consistent with the existing project structure.

## Before You Start

- Read the README to understand the current command surface and runtime layout.
- Open an issue for substantial changes before starting work.
- Keep changes scoped to one problem or feature per pull request.
- Do not change business logic unless the task specifically requires it.

## Development Setup

```bash
npm install
npx prisma generate
npm run build
```

## Recommended Workflow

1. Create a feature branch.
2. Make the smallest change that solves the problem.
3. Add or update tests for the affected area.
4. Run the relevant validation commands locally.
5. Open a pull request with a clear summary and verification notes.

## Code Quality Expectations

- Prefer small, reviewable changes.
- Keep TypeScript strictness and linting green.
- Avoid introducing ad hoc console output unless the CLI command requires it.
- Preserve the existing command names and public interfaces where possible.

## Testing Expectations

Add tests for any behavior that changes. Good coverage areas for this repository include:

- CLI command registration and option parsing
- Configuration loading and persistence
- Storage provider behavior
- Database connection helpers
- Backup, restore, schedule, and notification flows
- Error handling and edge cases

Run the available checks before submitting:

```bash
npm run build
npm run lint
npm run test:services
npm run test:phase4
```

## Pull Request Checklist

- [ ] Change is focused and self-contained
- [ ] Tests were added or updated
- [ ] Local validation was run
- [ ] README or docs were updated if needed
- [ ] No secrets or environment-specific values were committed

## Release Contributions

If your change affects packaging, release notes, or repository automation, call that out explicitly in the pull request description so it can be reviewed as a release engineering change.
