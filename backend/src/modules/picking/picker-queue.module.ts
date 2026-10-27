import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PickerQueueService } from './picker-queue.service';

/**
 * Módulo aislado del despachador de colas de picking.
 *
 * Vive aparte de `PickingModule` y de `OrdersModule` para no crear un ciclo de
 * módulos: `OrdersService` lo importa para despachar pedidos nuevos, y el
 * controlador de picking lo importa para disponibilidad/heartbeat. Solo depende
 * de la BD (global) y de las notificaciones push.
 */
@Module({
  imports: [NotificationsModule],
  providers: [PickerQueueService],
  exports: [PickerQueueService],
})
export class PickerQueueModule {}
