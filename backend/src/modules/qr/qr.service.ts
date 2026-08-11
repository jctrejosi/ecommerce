import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { media, settings } from '../../../drizzle/schema';
import { GenerateQrDto, SaveQrConfigDto } from './qr.dto';

const QR_CONFIG_KEY = 'payment_qr_config';
const DEFAULT_QR_ANALYZER_URL = 'http://localhost:8000';

@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);
  private readonly qrAnalyzerUrl: string;

  constructor(private readonly drizzle: DrizzleService) {
    this.qrAnalyzerUrl = (
      process.env.QR_ANALYZER_URL ?? DEFAULT_QR_ANALYZER_URL
    ).replace(/\/+$/, '');
    this.logger.log(`QR Analyzer configurado en: ${this.qrAnalyzerUrl}`);
  }

  private get db() {
    return this.drizzle.db;
  }

  // ── Comunicación con el servicio QR Analyzer ─────────────

  private async request<T>(
    path: string,
    init?: RequestInit,
    timeoutMs = 15000,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.qrAnalyzerUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ServiceUnavailableException(
          `El servicio QR Analyzer respondió ${res.status}: ${body.slice(0, 300)}`,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `No se pudo contactar el servicio QR Analyzer (${this.qrAnalyzerUrl}): ${message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async status() {
    try {
      const health = await this.request<Record<string, unknown>>(
        '/health',
        {},
        5000,
      );
      return { available: true, url: this.qrAnalyzerUrl, ...health };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { available: false, url: this.qrAnalyzerUrl, detail: message };
    }
  }

  async generate(dto: GenerateQrDto) {
    const payload = {
      text: dto.text,
      format: dto.format ?? 'png',
      size: dto.size ?? 400,
      error_correction: dto.errorCorrection ?? 'M',
      border: dto.border ?? 4,
    };
    this.logger.log(
      `Generando QR (${payload.format}) para: ${dto.text.slice(0, 60)}`,
    );
    return this.request<Record<string, unknown>>('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async decodeFile(buffer: Buffer, filename: string, mimetype: string) {
    const form = new FormData();
    // Buffer no es directamente un BlobPart en los tipos de TS: se copia a Uint8Array
    form.append(
      'file',
      new Blob([Uint8Array.from(buffer)], { type: mimetype }),
      filename,
    );
    return this.request<Record<string, unknown>>(
      '/decode',
      { method: 'POST', body: form },
      30000,
    );
  }

  // ── Persistencia del archivo QR (imagen o PDF) ────────────

  async saveQrFile(buffer: Buffer, filename: string, mimetype: string) {
    const checksum = `qr_${createHash('sha1').update(buffer).digest('hex')}`;
    const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
    const mediaType = mimetype === 'application/pdf' ? 'document' : 'image';

    const [inserted] = await this.db
      .insert(media)
      .values({
        path: dataUri,
        fileName: filename,
        mimeType: mimetype,
        sizeBytes: buffer.length,
        checksum,
        mediaType,
        provider: 'data',
        status: 'active',
        isPublic: true,
      })
      .onConflictDoNothing()
      .returning({ id: media.id });

    let mediaId = inserted ? Number(inserted.id) : undefined;

    if (!mediaId) {
      const existing = await this.db
        .select({ id: media.id })
        .from(media)
        .where(eq(media.checksum, checksum))
        .limit(1);
      mediaId = existing.length ? Number(existing[0].id) : undefined;
    }

    return { mediaId, url: dataUri, fileName: filename, mimeType: mimetype };
  }

  // ── Configuración guardada (cómo se genera el QR) ────────

  async getConfig() {
    const rows = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, QR_CONFIG_KEY))
      .limit(1);

    const config = rows.length
      ? (rows[0].value as Record<string, unknown>)
      : null;

    // Resolver la URL del archivo guardado (imagen o PDF)
    if (config && typeof config.fileMediaId === 'number') {
      const mediaRow = await this.db
        .select({ path: media.path })
        .from(media)
        .where(eq(media.id, config.fileMediaId as any))
        .limit(1);
      return {
        ...config,
        fileMediaId: config.fileMediaId,
        url: mediaRow.length ? mediaRow[0].path : null,
      };
    }
    return config ?? null;
  }

  async saveConfig(dto: SaveQrConfigDto) {
    const current = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, QR_CONFIG_KEY))
      .limit(1);

    const previous = current.length
      ? (current[0].value as Record<string, unknown>)
      : {};

    const config = {
      enabled: dto.enabled ?? previous.enabled ?? true,
      fileMediaId: dto.fileMediaId ?? previous.fileMediaId ?? null,
      fileName: dto.fileName ?? previous.fileName ?? null,
      mimeType: dto.mimeType ?? previous.mimeType ?? null,
      source: dto.source ?? previous.source ?? null,
      text: dto.text ?? previous.text ?? null,
      decoded: dto.decoded ?? previous.decoded ?? null,
      generation: dto.generation ?? previous.generation ?? null,
      updatedAt: new Date().toISOString(),
    };

    if (current.length) {
      await this.db
        .update(settings)
        .set({ value: config, updatedAt: new Date().toISOString() })
        .where(eq(settings.key, QR_CONFIG_KEY));
    } else {
      await this.db.insert(settings).values({
        key: QR_CONFIG_KEY,
        value: config,
        dataType: 'json',
        module: 'qr',
        description:
          'Configuración del QR de pago (archivo + método de generación)',
        isPublic: true,
      });
    }

    return this.getConfig();
  }

  async getPublicConfig() {
    const config = await this.getConfig();
    if (!config || config.enabled === false || !config.fileMediaId) {
      return {
        enabled: false,
        url: null,
        format: null,
        text: null,
        updatedAt: config?.updatedAt ?? null,
      };
    }
    return {
      enabled: true,
      url: config.url ?? null,
      format: config.mimeType === 'application/pdf' ? 'pdf' : 'image',
      text: config.text ?? null,
      updatedAt: config.updatedAt ?? null,
    };
  }
}
