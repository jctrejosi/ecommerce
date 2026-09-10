import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

interface AuthenticatedCustomer {
  sub: number;
}

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@UseGuards(CustomerJwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear pedido desde el checkout' })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, description: 'Pedido creado correctamente' })
  checkout(
    @CurrentUser() customer: AuthenticatedCustomer,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.checkout(customer.sub, dto);
  }

  /** Checkout SIN iniciar sesión: crea una sesión invitado automáticamente. */
  @Public()
  @Post('guest-checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear pedido sin iniciar sesión (invitado)' })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, description: 'Pedido de invitado creado' })
  guestCheckout(@Body() dto: CreateOrderDto) {
    return this.ordersService.checkoutGuest(dto);
  }

  /** Consulta pública de un pedido por su código de referencia. */
  @Public()
  @Get('track/:referenceCode')
  @ApiOperation({ summary: 'Consultar pedido por código de referencia' })
  trackOrder(@Param('referenceCode') referenceCode: string) {
    return this.ordersService.trackOrder(referenceCode);
  }

  /** Seguimiento en vivo de la entrega (repartidor en el mapa), por código. */
  @Public()
  @Get('track/:referenceCode/live')
  @ApiOperation({ summary: 'Seguimiento en vivo del repartidor (por código)' })
  liveTracking(@Param('referenceCode') referenceCode: string) {
    return this.ordersService.getLiveTracking(referenceCode);
  }

  /** Ruta por calles (OSRM) repartidor → domicilio, para el mapa del cliente. */
  @Public()
  @Get('track/:referenceCode/route')
  @ApiOperation({ summary: 'Ruta por calles del pedido (por código)' })
  liveRoute(@Param('referenceCode') referenceCode: string) {
    return this.ordersService.getLiveRoute(referenceCode);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener pedidos del cliente autenticado' })
  @ApiResponse({ status: 200, description: 'Listado de pedidos del cliente' })
  getOrders(@CurrentUser() customer: AuthenticatedCustomer) {
    return this.ordersService.getOrders(customer.sub);
  }
}
