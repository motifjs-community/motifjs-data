# Contributing to @motifx-community/data

Thanks for taking the time to help. Bug reports, fixes, tests and documentation improvements are all welcome.

For anything larger than a small fix, please open an issue first so we can agree on the direction before you spend
time on it. Questions and ideas go to the [MotifJS discussions](https://github.com/motifjsdev/motifjs/discussions).

## Setup

Node.js 22 or newer. The design system is a dependency by path until it is published (the demo draws with it):
clone it next to this repository and build it once.

```sh
git clone https://github.com/motifjs-community/motifjs-design-system
git clone https://github.com/motifjs-community/motifjs-data
cd motifjs-design-system && npm ci && npm run build && cd ..
cd motifjs-data && npm ci
npm run dev     # the demo: one tab per use, each against a real service
```

## Checks

`npm run check` is what CI runs: typecheck, `motif-lint`, the tests, the package build and the demo build. The tests
cover the adapters with fakes, so they run anywhere. The adapters are also run against real services:

```sh
npm run test:live     # public demo services (OData Northwind and TripPin, DummyJSON, JSONPlaceholder, CountryInfo)
npm run wcf           # the local WCF service of the SOAP tests, built from tests/live/wcf-service (needs the .NET 9 SDK)
```

The live run is not part of CI, a service being down must not block a pull request; it runs on a schedule instead.

## Making a change

- Keep a pull request focused on one thing. Two unrelated fixes are easier to review as two pull requests.
- Add a test that fails without your change and passes with it. Error paths are tested with fakes; a happy path
  also gets a live test when a public service shows it.
- A feature of the data layer is opt-in per adapter and never probed: with it off, the requests an adapter sends
  stay exactly what they were, and a test says so.
- The developer's objects come back as given: an adapter or a data source never copies, wraps or changes a row.
- A change visible to users gets a line in CHANGELOG.md under "Unreleased".
- Write commit messages as a short summary line in the imperative ("Fix list reorder after splice"), with a body
  that explains why when it is not obvious.

## Reporting bugs

Please use the bug report form and include a minimal reproduction: the smallest component or snippet that shows the
problem, what you expected and what happened instead.

Security issues should not be reported in public issues. See the
[security policy](https://github.com/motifjs-community/.github/blob/main/SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](https://github.com/motifjs-community/.github/blob/main/CODE_OF_CONDUCT.md). By taking part you agree
to follow it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) of this repository.
