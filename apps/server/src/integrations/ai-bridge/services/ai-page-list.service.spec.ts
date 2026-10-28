import { createHmac } from 'node:crypto';
import { stub } from '../test-stub';
import { AiPageListRepo } from '@docmost/db/repos/page/ai-page-list.repo';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiPageListService } from './ai-page-list.service';

const BRIDGE_KEY = 'test-bridge-secret-0123456789abcdef';
const FIRST_ID = '0192f000-0000-7000-8000-000000000001';
const LAST_ID = '0192f000-0000-7000-8000-000000000002';
const UPDATED_AT = new Date('2026-10-01T08:30:00.000Z');

const page = (id: string) => ({
  id,
  spaceId: 'space-1',
  updatedAt: UPDATED_AT,
});

describe('AiPageListService', () => {
  const aiPageListRepo = { listIndexablePages: jest.fn() };
  const environmentService = { getAiBridgeSecret: jest.fn() };
  const service = new AiPageListService(
    stub<AiPageListRepo>(aiPageListRepo),
    stub<EnvironmentService>(environmentService),
  );

  const firstCursor = async () => {
    const { nextCursor } = await service.listPages(undefined);
    if (!nextCursor) throw new Error('expected a cursor');
    return nextCursor;
  };

  const expectInvalid = async (cursor: string) => {
    const error = await service.listPages(cursor).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiBridgeError);
    expect((error as AiBridgeError).code).toBe('invalid_request');
  };

  beforeEach(() => {
    jest.resetAllMocks();
    environmentService.getAiBridgeSecret.mockReturnValue(BRIDGE_KEY);
    aiPageListRepo.listIndexablePages.mockResolvedValue({
      pages: [page(FIRST_ID), page(LAST_ID)],
      hasNextPage: true,
    });
  });

  it('INDEX-AC44: the cursor names the last page and carries a signature, not the bare id', async () => {
    const cursor = await firstCursor();

    expect(cursor).not.toBe(LAST_ID);
    expect(cursor).toMatch(new RegExp(`^${LAST_ID}\\.[A-Za-z0-9_-]{43}$`));
    expect(aiPageListRepo.listIndexablePages).toHaveBeenCalledWith(
      undefined,
      500,
    );
  });

  it('INDEX-AC44: a returned cursor resumes after its page', async () => {
    const cursor = await firstCursor();

    await service.listPages(cursor);

    expect(aiPageListRepo.listIndexablePages).toHaveBeenLastCalledWith(
      LAST_ID,
      500,
    );
  });

  it('INDEX-AC44: the last part has no cursor', async () => {
    aiPageListRepo.listIndexablePages.mockResolvedValue({
      pages: [page(FIRST_ID)],
      hasNextPage: false,
    });

    await expect(service.listPages(undefined)).resolves.toEqual({
      pages: [
        {
          id: FIRST_ID,
          spaceId: 'space-1',
          updatedAt: UPDATED_AT.toISOString(),
        },
      ],
      nextCursor: null,
    });
  });

  it.each([
    ['a word', 'not-a-cursor'],
    ['a bare page id', LAST_ID],
    ['an id with an empty signature', `${LAST_ID}.`],
    ['an extra part', `${LAST_ID}.abc.def`],
  ])(
    'INDEX-AC48: %s answers invalid_request without reading pages',
    async (_name, cursor) => {
      await expectInvalid(cursor);
      expect(aiPageListRepo.listIndexablePages).not.toHaveBeenCalled();
    },
  );

  it('INDEX-AC48: a cursor with a tampered signature answers invalid_request', async () => {
    const cursor = await firstCursor();
    const tampered = cursor.slice(0, -1) + (cursor.endsWith('A') ? 'B' : 'A');

    await expectInvalid(tampered);
  });

  it('INDEX-AC48: a signature moved to another page id answers invalid_request', async () => {
    const signature = (await firstCursor()).split('.')[1];

    await expectInvalid(`${FIRST_ID}.${signature}`);
  });

  it('INDEX-AC48: a cursor signed with another secret answers invalid_request', async () => {
    const cursor = await firstCursor();
    environmentService.getAiBridgeSecret.mockReturnValue(`${BRIDGE_KEY}-new`);

    await expectInvalid(cursor);
  });

  it('INDEX-AC48: a correctly signed value that is no page id answers invalid_request', async () => {
    const signature = createHmac('sha256', BRIDGE_KEY)
      .update('not-a-page-id')
      .digest('base64url');

    await expectInvalid(`not-a-page-id.${signature}`);
  });
});
