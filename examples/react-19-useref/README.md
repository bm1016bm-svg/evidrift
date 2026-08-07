# React 19 `useRef` contract drift

This is a real dependency upgrade, not a synthetic declaration. React's official React 19
upgrade guide documents that `useRef` now requires an argument. This lab records the third
`useRef` overload from `@types/react@18.3.12`, upgrades only the installed type package to
`@types/react@19.0.1`, and proves that Evidrift reports the changed contract.

From the repository root:

```bash
npm run demo:react-19
```

The script uses exact package versions, installs with lifecycle scripts disabled, verifies the
installed version after each step, and expects the final `evidrift check` to fail. A successful
demo process therefore means the drift was caught, not that the contracts matched.

Source: [React 19 Upgrade Guide — `useRef` requires an argument](https://react.dev/blog/2024/04/25/react-19-upgrade-guide#useref-requires-an-argument).
