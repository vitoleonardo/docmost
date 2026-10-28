import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AiAssistantStatus,
  AiStatusService,
} from './services/ai-status.service';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiBridgeController {
  constructor(private readonly aiStatusService: AiStatusService) {}

  @HttpCode(HttpStatus.OK)
  @Post('status')
  status(@AuthUser() user: User): Promise<{ status: AiAssistantStatus }> {
    return this.aiStatusService.status(user);
  }
}
