# Data runs

Seeded: `KIT_SEED` then `KIT_E2E`. Mocked: `KIT_TEST_MOCKED`. The seed version and the mock set are the last `seed:` and `mocked:` lines the commands print.

| Run | Result | Time | Command | Seed, mock set or e2e selection |
|-----|--------|------|---------|---------------------------------|
| seed | pass | 13s | `pnpm --filter "./packages/*" run build && pnpm seed && echo "seed: $(git rev-parse --short HEAD:apps/server/src/integrations/seed)"` | seed: 27d3c29f |
| e2e | fail | 37s | `pnpm --filter ./apps/server run test:e2e` | all: KIT_E2E_RELATED is not set |
| mocked | not configured | – | – | – |

## Failures

### e2e

```text
      16 |   });
      17 |

      at loadPackage (../../../node_modules/.pnpm/@nestjs+common@11.2.7_class-transformer@0.5.1_class-validator@0.15.1_reflect-metadata@0_35ef61e37b6f329e0d127fa1893c2392/node_modules/@nestjs/common/utils/load-package.util.js:14:17)
      at TestingModule.createHttpAdapter (../../../node_modules/.pnpm/@nestjs+testing@11.1.19_@nestjs+common@11.2.7_class-transformer@0.5.1_class-validator@0_b84809022a4db281507f7616412bd63c/node_modules/@nestjs/testing/testing-module.js:36:72)
      at TestingModule.createNestApplication (../../../node_modules/.pnpm/@nestjs+testing@11.1.19_@nestjs+common@11.2.7_class-transformer@0.5.1_class-validator@0_b84809022a4db281507f7616412bd63c/node_modules/@nestjs/testing/testing-module.js:24:21)
      at Object.<anonymous> (app.e2e-spec.ts:14:25)
[Nest] 55977  - 10/29/2026, 6:55:15 PM   ERROR [PackageLoader] The "@nestjs/platform-express" package is missing. Please, make sure to install it to take advantage of NestFactory.
  ●  process.exit called with "1"

      12 |     }).compile();
      13 |
    > 14 |     app = moduleFixture.createNestApplication();
         |                         ^
      15 |     await app.init();
      16 |   });
      17 |

      at loadPackage (../../../node_modules/.pnpm/@nestjs+common@11.2.7_class-transformer@0.5.1_class-validator@0.15.1_reflect-metadata@0_35ef61e37b6f329e0d127fa1893c2392/node_modules/@nestjs/common/utils/load-package.util.js:14:17)
      at TestingModule.createHttpAdapter (../../../node_modules/.pnpm/@nestjs+testing@11.1.19_@nestjs+common@11.2.7_class-transformer@0.5.1_class-validator@0_b84809022a4db281507f7616412bd63c/node_modules/@nestjs/testing/testing-module.js:36:72)
      at TestingModule.createNestApplication (../../../node_modules/.pnpm/@nestjs+testing@11.1.19_@nestjs+common@11.2.7_class-transformer@0.5.1_class-validator@0_b84809022a4db281507f7616412bd63c/node_modules/@nestjs/testing/testing-module.js:24:21)
      at Object.<anonymous> (app.e2e-spec.ts:14:25)
FAIL test/app.e2e-spec.ts
  ● Test suite failed to run

    Jest worker encountered 4 child process exceptions, exceeding retry limit

      at ChildProcessWorker.initialize (../../../node_modules/.pnpm/jest-worker@30.3.0/node_modules/jest-worker/build/index.js:805:21)

A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 1 failed, 1 passed, 2 total
Tests:       55 passed, 55 total
Snapshots:   0 total
Time:        36.336 s
Ran all test suites.
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
/Users/vito/Documents/GitHub/docmost/.work/wt-m2-verify/apps/server:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] server@0.96.0 test:e2e: `jest --config test/jest-e2e.json`
Exit status 1
```
