import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { Page } from '@docmost/db/types/entity.types';

export type IndexablePage = Pick<Page, 'id' | 'spaceId' | 'updatedAt'>;

export interface IndexablePagesPart {
  pages: IndexablePage[];
  hasNextPage: boolean;
}

@Injectable()
export class AiPageListRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async listIndexablePages(
    afterId: string | undefined,
    limit: number,
  ): Promise<IndexablePagesPart> {
    let query = this.db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select(['pages.id', 'pages.spaceId', 'pages.updatedAt'])
      .where('pages.deletedAt', 'is', null)
      .where('spaces.deletedAt', 'is', null);
    if (afterId) query = query.where('pages.id', '>', afterId);
    const rows = await query
      .orderBy('pages.id')
      .limit(limit + 1)
      .execute();

    return {
      pages: rows.slice(0, limit),
      hasNextPage: rows.length > limit,
    };
  }
}
