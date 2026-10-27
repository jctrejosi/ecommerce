import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CustomerJwtAuthGuard } from '../customer-auth/guards/customer-jwt-auth.guard';
import { CartService } from './cart.service';
import { UpdateCartDto } from './dto/update-cart.dto';
import { QuoteCartDto } from './dto/quote-cart.dto';

interface AuthenticatedCustomer {
  sub: number;
}

@ApiTags('Cart')
@ApiBearerAuth('JWT-auth')
@UseGuards(CustomerJwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Public()
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cotizar ítems (subtotal, descuentos y total) sin persistir',
  })
  @ApiResponse({ status: 200, description: 'Cotización calculada' })
  quote(@Body() dto: QuoteCartDto) {
    return this.cartService.quote(dto.items, dto.branchId ?? null);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener carrito del cliente autenticado' })
  @ApiResponse({ status: 200, description: 'Carrito obtenido correctamente' })
  getCart(@CurrentUser() customer: AuthenticatedCustomer) {
    return this.cartService.getCart(customer.sub);
  }

  @Put()
  @ApiOperation({ summary: 'Actualizar carrito del cliente autenticado' })
  @ApiBody({ type: UpdateCartDto })
  @ApiResponse({ status: 200, description: 'Carrito actualizado correctamente' })
  updateCart(
    @CurrentUser() customer: AuthenticatedCustomer,
    @Body() dto: UpdateCartDto,
  ) {
    return this.cartService.updateCart(customer.sub, dto);
  }
}
