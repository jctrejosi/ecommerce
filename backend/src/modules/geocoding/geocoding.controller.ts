import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { GeocodingService } from './geocoding.service';

/**
 * Geocodificación para el checkout: buscar la dirección que escribe el cliente
 * y resolver qué dirección hay bajo el marcador del mapa.
 *
 * Son públicos porque el checkout también funciona para invitados (compra sin
 * registrarse), igual que `/orders/track/:referenceCode`.
 */
@ApiTags('Geocoding')
@Controller('geocode')
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Buscar direcciones por texto' })
  @ApiQuery({ name: 'q', description: 'Texto de la dirección (mín. 4 letras)' })
  @ApiResponse({ status: 200, description: 'Coincidencias ordenadas por relevancia' })
  search(@Query('q') q: string) {
    return this.geocodingService.search(q ?? '');
  }

  @Public()
  @Get('reverse')
  @ApiOperation({ summary: 'Dirección más cercana a unas coordenadas' })
  @ApiQuery({ name: 'lat', description: 'Latitud del marcador' })
  @ApiQuery({ name: 'lng', description: 'Longitud del marcador' })
  @ApiResponse({ status: 200, description: 'Dirección encontrada o null' })
  reverse(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.geocodingService.reverse(Number(lat), Number(lng));
  }
}
