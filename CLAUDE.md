# CLAUDE.md — Orchestrator Agent: Concurrency Limiter System

## Mission
You are the **Orchestrator Agent**. Your sole responsibility is to coordinate 4 sub-agents that together build a production-grade TypeScript concurrency limiter. You do NOT write implementation code yourself. You spawn agents, validate their outputs, enforce contracts between them, and block progress until quality gates pass.

---

## Project Structure You Must Create First

```
concurrency-limiter/
├── CLAUDE.md                        ← this file (orchestrator)
├── agents/
│   ├── agent-types.md               ← Agent 1 prompt
│   ├── agent-core.md                ← Agent 2 prompt
│   ├── agent-http.md                ← Agent 3 prompt
│   └── agent-tests.md               ← Agent 4 prompt
├── src/
│   ├── types.ts                     ← Agent 1 output
│   ├── concurrency-limiter.ts       ← Agent 2 output
│   ├── http-request-limiter.ts      ← Agent 3 output
│   └── index.ts                     ← Agent 2 output (barrel)
├── tests/
│   ├── concurrency-limiter.test.ts  ← Agent 4 output
│   ├── http-request-limiter.test.ts ← Agent 4 output
│   └── helpers/
│       └── controlled-task.ts       ← Agent 4 output
├── package.json
├── tsconfig.json
└── jest.config.ts
```

---

## Execution Plan — Run Strictly in Order

### PHASE 0 — Bootstrap (YOU do this before spawning any agent)

Run these shell commands:
```bash
mkdir -p concurrency-limiter/{src,tests/helpers,agents}
cd concurrency-limiter
npm init -y
npm install --save-dev typescript ts-jest jest @types/jest @types/node
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Create `jest.config.ts`:
```typescript
import type { Config } from 'jest';
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageThreshold: {
    global: { branches: 100, functions: 100, lines: 100, statements: 100 }
  }
};
export default config;
```

---

### PHASE 1 — Spawn Agent 1 (Types)

**Command to run in Claude Code:**
```
claude --print < agents/agent-types.md > src/types.ts
```

**Gate — BLOCK Agent 2 until ALL pass:**
```bash
npx tsc --noEmit --project tsconfig.json
grep -E "export (type|interface)" src/types.ts | wc -l  # must be >= 5
grep "any" src/types.ts                                  # must return nothing
```

---

### PHASE 2 — Spawn Agent 2 (Core)

**Command:**
```
claude --print < agents/agent-core.md > src/concurrency-limiter.ts
```

**Gate — BLOCK Agent 3 until ALL pass:**
```bash
npx tsc --noEmit
grep "any" src/concurrency-limiter.ts    # must return nothing
grep "TODO\|FIXME\|HACK" src/concurrency-limiter.ts  # must return nothing
```

---

### PHASE 3 — Spawn Agent 3 (HTTP Wrapper)

**Command:**
```
claude --print < agents/agent-http.md > src/http-request-limiter.ts
```

**Gate:**
```bash
npx tsc --noEmit
grep "any" src/http-request-limiter.ts  # must return nothing
```

---

### PHASE 4 — Spawn Agent 4 (Tests)

**Command:**
```
claude --print < agents/agent-tests.md > tests/concurrency-limiter.test.ts
```

**Gate — ALL must pass:**
```bash
npx jest --coverage --coverageThreshold='{"global":{"lines":100}}'
# Zero test failures
# Zero TypeScript errors
# 100% line coverage
```

---

### PHASE 5 — Conflict Check (YOU run this)

```bash
# Check no circular imports
npx madge --circular src/

# Check exports are consistent
npx tsc --noEmit

# Final full test run
npx jest --verbose --coverage
```

If ANY phase gate fails → re-run that agent with the error output appended to its prompt. Max 3 retries per agent. If still failing, halt and report.

---

## Your Reporting Format

After all phases complete, output:
```
ORCHESTRATOR REPORT
===================
Phase 1 (Types):    ✓ PASSED | gate checks: 3/3
Phase 2 (Core):     ✓ PASSED | gate checks: 3/3
Phase 3 (HTTP):     ✓ PASSED | gate checks: 2/2
Phase 4 (Tests):    ✓ PASSED | coverage: 100% | tests: N passed
Phase 5 (Conflict): ✓ PASSED | no circular deps

READY FOR PRODUCTION
```
