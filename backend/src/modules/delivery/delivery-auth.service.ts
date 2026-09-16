import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { AuthService } from '../auth/auth.service';
import { deliveryDrivers, users } from '../../../drizzle/schema';
import { DeliveryLoginDto } from './dto/login.dto';
import { RefreshTokenDto } from '../auth/dto/refresh-token.dto';

@Injectable()
export class DeliveryAuthService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly authService: AuthService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  private toDriverUser(
    driver: typeof deliveryDrivers.$inferSelect,
    user: typeof users.$inferSelect,
  ) {
    return {
      id: Number(driver.id),
      username: user.username,
      fullName:
        driver.fullName ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        'Repartidor',
      phone: driver.phone ?? user.phone ?? null,
      email: driver.email ?? user.email ?? null,
      role: 'driver',
      vehicleType: driver.vehicleType,
      vehiclePlate: driver.vehiclePlate,
      vehicleBrand: driver.vehicleBrand,
      vehicleModel: driver.vehicleModel,
      isAvailable: driver.isAvailable,
      isActive: driver.isActive,
      // URL pública en Cloudinary de la foto de perfil (null si no tiene).
      avatarUrl: driver.avatarUrl ?? null,
    };
  }

  async login(dto: DeliveryLoginDto) {
    const result = await this.authService.login({
      identifier: dto.username,
      password: dto.password,
    });

    const driver = await this.findDriver(result.user.id);
    if (!driver || !driver.isActive) {
      throw new ForbiddenException('La cuenta no corresponde a un repartidor activo.');
    }

    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.id, BigInt(result.user.id)))
      .limit(1);

    return { ...result, user: this.toDriverUser(driver, user[0]) };
  }

  async me(authUserId: number) {
    const driver = await this.findDriver(authUserId);
    if (!driver) {
      throw new UnauthorizedException('No hay repartidor asociado a esta cuenta.');
    }
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.id, BigInt(authUserId)))
      .limit(1);
    if (!user.length) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }
    return this.toDriverUser(driver, user[0]);
  }

  async refresh(dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  private async findDriver(authUserId: number) {
    const rows = await this.db
      .select()
      .from(deliveryDrivers)
      .where(
        and(
          eq(deliveryDrivers.authUserId, authUserId),
          isNull(deliveryDrivers.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
