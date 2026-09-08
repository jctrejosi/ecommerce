import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DeliveryAuthService } from './delivery-auth.service';
import { DeliveryLoginDto } from './dto/login.dto';
import { RefreshTokenDto } from '../auth/dto/refresh-token.dto';

@Controller('delivery/auth')
export class DeliveryAuthController {
  constructor(private readonly auth: DeliveryAuthService) {}

  @Post('login')
  login(@Body() dto: DeliveryLoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser('sub') userId: bigint) {
    return this.auth.me(Number(userId));
  }
}
