import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DeliveryAuthService } from './delivery-auth.service';
import { DeliveryService } from './delivery.service';
import { DeliveryOrdersService } from './delivery-orders.service';
import { DriverChatService } from './driver-chat.service';
import { TransitionDto } from './dto/transition.dto';
import { AvailabilityDto } from './dto/availability.dto';
import { PushTokenDto } from './dto/push-token.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('delivery')
@UseGuards(JwtAuthGuard)
export class DeliveryOrdersController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly orders: DeliveryOrdersService,
    private readonly auth: DeliveryAuthService,
    private readonly chat: DriverChatService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get('orders')
  list(@CurrentUser('sub') userId: bigint) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.listActive(Number(driver.id)),
    );
  }

  @Get('orders/:id')
  get(@CurrentUser('sub') userId: bigint, @Param('id') id: string) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.getOrder(Number(driver.id), Number(id)),
    );
  }

  // Importante: estas rutas van ANTES de 'orders/:id/:action' para que
  // 'messages' no se interprete como una acción de transición.
  @Get('orders/:id/messages')
  messages(@CurrentUser('sub') userId: bigint, @Param('id') id: string) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.getChatMessages(Number(driver.id), Number(id)),
    );
  }

  @Post('orders/:id/messages')
  sendMessage(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.sendChatMessage(
        Number(driver.id),
        Number(id),
        Number(userId),
        dto.body,
      ),
    );
  }

  /** Acuse de lectura del repartidor: marca como vistos los mensajes del cliente. */
  @Post('orders/:id/messages/read')
  @HttpCode(HttpStatus.OK)
  markMessagesRead(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
  ) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.markChatMessagesRead(Number(driver.id), Number(id)),
    );
  }

  @Post('orders/:id/:action')
  transition(
    @CurrentUser('sub') userId: bigint,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() payload: TransitionDto,
  ) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.transition(Number(driver.id), Number(id), action, payload),
    );
  }

  @Get('history')
  history(@CurrentUser('sub') userId: bigint) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.history(Number(driver.id)),
    );
  }

  @Put('profile/availability')
  availability(@CurrentUser('sub') userId: bigint, @Body() dto: AvailabilityDto) {
    return this.delivery.resolveDriver(Number(userId)).then(async (driver) => {
      await this.orders.setAvailability(Number(driver.id), dto.isAvailable);
      return this.auth.me(Number(userId));
    });
  }

  @Put('profile/push-token')
  pushToken(@CurrentUser('sub') userId: bigint, @Body() dto: PushTokenDto) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.orders.setPushToken(Number(driver.id), dto.token),
    );
  }

  /**
   * Foto de perfil del repartidor: sube el archivo a Cloudinary y guarda la URL
   * pública en su ficha (`delivery_drivers.avatar_url`). Devuelve el perfil
   * actualizado para que la app lo refresque de inmediato.
   */
  @Post('profile/avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser('sub') userId: bigint,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
  ) {
    if (!file?.buffer) throw new BadRequestException('Archivo requerido');

    const driver = await this.delivery.resolveDriver(Number(userId));
    const driverId = Number(driver.id);

    const { url } = await this.cloudinary.uploadImage(
      file,
      `driver_${driverId}`,
      {
        folder: `delivery/drivers/${driverId}`,
        // Avatar: cuadrado y ligero (lossless en una foto pesa demasiado).
        resize: 512,
        lossless: false,
      },
    );

    await this.delivery.setAvatarUrl(driverId, url);
    return this.auth.me(Number(userId));
  }

  // ─── Chat con el panel (repartidor ↔ admin) ─────────────────────────────────

  /** Resumen del hilo con el panel (no leídos + último mensaje). */
  @Get('admin-chat/summary')
  adminChatSummary(@CurrentUser('sub') userId: bigint) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.chat.summary(Number(driver.id), 'driver'),
    );
  }

  /** Hilo con el panel. Al abrirlo se marca lo recibido como leído. */
  @Get('admin-chat/messages')
  adminChatMessages(@CurrentUser('sub') userId: bigint) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.chat.listMessages(Number(driver.id), 'driver'),
    );
  }

  /** Envía un mensaje del repartidor al panel. */
  @Post('admin-chat/messages')
  adminChatSend(
    @CurrentUser('sub') userId: bigint,
    @Body() dto: SendMessageDto,
  ) {
    return this.delivery.resolveDriver(Number(userId)).then((driver) =>
      this.chat.sendFromDriver(Number(driver.id), Number(userId), dto.body),
    );
  }
}
