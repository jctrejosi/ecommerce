import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { settings } from '../../../drizzle/schema';

/** Definición canónica de funciones disponibles en el bot (misma lista que el bot Python). */
const BOT_FUNCTIONS = [
  {
    name: 'armar_carrito',
    label: 'Armar carrito con una lista',
    description: 'Arma el carrito con los productos que pida el cliente (ej: "arroz, fríjoles y lentejas").',
  },
  {
    name: 'armar_lista_sugerida',
    label: 'Armar lista sugerida',
    description: 'Arma una lista de compras sugerida (ofertas primero).',
  },
  {
    name: 'buscar_productos',
    label: 'Buscar productos',
    description: 'Busca productos del catálogo por nombre, marca o categoría.',
  },
  {
    name: 'ver_producto',
    label: 'Ver producto',
    description: 'Muestra el detalle de un producto (precio, stock, imágenes).',
  },
  {
    name: 'agregar_al_carrito',
    label: 'Agregar al carrito',
    description: 'Agrega un producto puntual al carrito.',
  },
  {
    name: 'ver_carrito',
    label: 'Ver carrito',
    description: 'Muestra el estado actual del carrito.',
  },
  {
    name: 'quitar_del_carrito',
    label: 'Quitar del carrito',
    description: 'Quita o reduce productos del carrito.',
  },
  {
    name: 'vaciar_carrito',
    label: 'Vaciar carrito',
    description: 'Vacía el carrito por completo.',
  },
  {
    name: 'finalizar_compra',
    label: 'Finalizar compra',
    description: 'Prepara el resumen final para el checkout.',
  },
  {
    name: 'consultar_receta',
    label: 'Consultar receta',
    description: 'Consulta una receta, arma el carrito con sus ingredientes y muestra los pasos de preparación.',
  },
];

const SETTINGS_KEY = 'bot.functions';

@Controller('admin/bot')
export class BotController {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  @Get('functions')
  async getFunctions() {
    const [row] = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .limit(1);

    const saved = (row?.value as Record<string, boolean> | undefined) ?? {};
    const functions = BOT_FUNCTIONS.map((f) => ({
      ...f,
      // Por defecto habilitadas; el valor guardado puede deshabilitarlas.
      enabled: saved[f.name] !== false,
    }));

    return { functions };
  }

  @Put('functions')
  @HttpCode(HttpStatus.OK)
  async updateFunctions(@Body() body: { functions?: Record<string, boolean> }) {
    const value = body.functions ?? {};

    const [existing] = await this.db
      .select({ id: settings.id })
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .limit(1);

    if (existing) {
      await this.db
        .update(settings)
        .set({ value, updatedAt: new Date().toISOString() })
        .where(eq(settings.key, SETTINGS_KEY));
    } else {
      await this.db.insert(settings).values({
        key: SETTINGS_KEY,
        value,
        dataType: 'json',
        module: 'bot',
        description: 'Funciones habilitadas del bot de compras',
        isPublic: true,
      } as any);
    }

    return this.getFunctions();
  }
}
