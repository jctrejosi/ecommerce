import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CouponsService } from './coupons.service';
import {
  IssueCouponDto,
  QueryCouponsDto,
  UpdateCouponDto,
} from './dto/coupon.dto';

@ApiTags('Admin - Cupones')
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar cupones' })
  findAll(@Query() query: QueryCouponsDto) {
    return this.couponsService.findAll(query);
  }

  @Get('generate-code')
  @ApiOperation({ summary: 'Sugerir un código único autogenerado' })
  async generateCode() {
    return { code: await this.couponsService.generateUniqueCode() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de cupón con sus movimientos' })
  findOne(@Param('id') id: string) {
    return this.couponsService.findOne(Number(id));
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Movimientos del cupón' })
  transactions(@Param('id') id: string) {
    return this.couponsService.getTransactions(Number(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Emitir uno o varios cupones' })
  issue(@Body() dto: IssueCouponDto) {
    return this.couponsService.issue(dto, null);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar / bloquear un cupón' })
  update(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.couponsService.update(Number(id), dto);
  }
}
