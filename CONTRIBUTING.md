# Contributing to awesome-agent-sdk

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/algomim/awesome-agent-sdk.git
cd awesome-agent-sdk
npm install
npm run build -ws
npm test -ws
```

## Pull Request Process

1. Fork the repository and create a feature branch from `main`
2. Write code following the existing patterns (SOLID, SRP, Clean Code)
3. Add tests for any new functionality
4. Ensure all tests pass: `npm test -ws`
5. Ensure the build succeeds: `npm run build -ws`
6. Open a PR with a clear description of the change

## Code Standards

- TypeScript strict mode
- All interfaces `readonly`
- No hardcoded magic numbers — use named constants
- Every public API must have tests
- Follow existing naming conventions (PascalCase classes, camelCase functions, UPPER_SNAKE constants)

## Reporting Issues

Use [GitHub Issues](https://github.com/algomim/awesome-agent-sdk/issues). Include:
- What you expected
- What happened
- Steps to reproduce
- Environment (Node version, OS)

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
