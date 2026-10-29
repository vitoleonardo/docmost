import { expect, test } from "@playwright/test";
import {
  SEED_GROUPS,
  SEED_SPACE_MEMBERSHIPS,
  SEED_USERS,
  SeedUserKey,
} from "../../server/src/integrations/seed/seed-definition";
import { screenshot, seedUserState } from "./screenshot";

function grantedSpaces(userKey: SeedUserKey) {
  const groups = SEED_GROUPS.filter((group) =>
    group.userKeys.includes(userKey),
  ).map((group) => group.name);
  return SEED_SPACE_MEMBERSHIPS.filter(
    (membership) =>
      membership.userKey === userKey ||
      (membership.groupName !== undefined &&
        groups.includes(membership.groupName)),
  ).map((membership) => membership.space);
}

for (const user of SEED_USERS) {
  test.describe(user.key, () => {
    test.use({ storageState: seedUserState(user.key) });

    test(`SEED-AC3: ${user.key} sees the spaces the matrix grants`, async ({
      page,
    }, testInfo) => {
      await page.goto("/spaces");
      const spaces = grantedSpaces(user.key);
      for (const space of spaces) {
        await expect(
          page.getByText(space, { exact: true }).first(),
        ).toBeVisible();
      }
      await expect(page.locator("tbody tr")).toHaveCount(spaces.length);
      await screenshot(page, testInfo, "SEED-AC3", user.key.toLowerCase());
    });
  });
}
