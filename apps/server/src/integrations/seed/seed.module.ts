import { Module } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { AuthModule } from '../../core/auth/auth.module';
import { SpaceModule } from '../../core/space/space.module';
import { SeedService } from './seed.service';
import { SeedContentService } from './seed-content.service';

@Module({
  imports: [AppModule, AuthModule, SpaceModule],
  providers: [SeedService, SeedContentService],
})
export class SeedModule {}
