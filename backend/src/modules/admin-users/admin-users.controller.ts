import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequireModule } from '../../common/decorators/permissions.decorator';
import { AdminUsersService } from './admin-users.service';
import {
  CreateAdminUserDto,
  CreateRoleDto,
  ResetAdminPasswordDto,
  SetRolePermissionsDto,
  UpdateAdminUserDto,
  UpdateRoleDto,
} from './dto/admin-user.dto';

/**
 * Administración de usuarios, roles y permisos para el panel web admin.
 * Requiere `admin:users:view` (lectura) o `admin:users:manage` (escritura);
 * el superusuario siempre tiene acceso.
 */
@ApiTags('Admin Users & Permissions')
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireModule('admin:users')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  // ─── Usuarios ────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'Usuarios de panel (admin, picking y delivery)' })
  listUsers(@Query('kind') kind?: string) {
    const normalized =
      kind === 'admin' || kind === 'picking' || kind === 'delivery'
        ? kind
        : undefined;
    return this.adminUsers.listUsers(normalized);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Detalle de un usuario' })
  getUser(@Param('id', ParseIntPipe) id: number) {
    return this.adminUsers.getUser(id);
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un usuario de panel (admin o picking)' })
  createUser(@Body() dto: CreateAdminUserDto) {
    return this.adminUsers.createUser(dto);
  }

  @Put('users/:id')
  @ApiOperation({ summary: 'Actualiza un usuario y sus roles' })
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.adminUsers.updateUser(id, dto);
  }

  @Post('users/:id/reset-password')
  @ApiOperation({ summary: 'Restablece la contraseña de un usuario' })
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetAdminPasswordDto,
  ) {
    return this.adminUsers.resetPassword(id, dto.password);
  }

  // ─── Roles ───────────────────────────────────────────────────────────────

  @Get('roles')
  @ApiOperation({ summary: 'Roles con conteo de usuarios y permisos' })
  listRoles() {
    return this.adminUsers.listRoles();
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un rol' })
  createRole(@Body() dto: CreateRoleDto) {
    return this.adminUsers.createRole(dto);
  }

  @Put('roles/:id')
  @ApiOperation({ summary: 'Actualiza un rol' })
  updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.adminUsers.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @ApiOperation({ summary: 'Elimina un rol (no del sistema)' })
  deleteRole(@Param('id', ParseIntPipe) id: number) {
    return this.adminUsers.deleteRole(id);
  }

  @Get('roles/:id/permissions')
  @ApiOperation({ summary: 'Permisos asignados a un rol' })
  getRolePermissions(@Param('id', ParseIntPipe) id: number) {
    return this.adminUsers.getRolePermissions(id);
  }

  @Put('roles/:id/permissions')
  @ApiOperation({ summary: 'Reemplaza los permisos de un rol' })
  setRolePermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.adminUsers.setRolePermissions(id, dto.permissionCodes);
  }

  // ─── Permisos ────────────────────────────────────────────────────────────

  @Get('permissions')
  @ApiOperation({ summary: 'Permisos agrupados por interface (módulo)' })
  listPermissions() {
    return this.adminUsers.listPermissions();
  }
}
