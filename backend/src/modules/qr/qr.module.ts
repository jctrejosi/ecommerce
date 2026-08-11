import { Module } from '@nestjs/common';
import { AdminQrController, QrPublicController } from './qr.controller';
import { QrService } from './qr.service';

@Module({
  controllers: [AdminQrController, QrPublicController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
