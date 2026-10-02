import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { removeBackground } from '@imgly/background-removal-node';
import {
  resolveMediaStaticRoot,
  sanitizeMediaFolder,
} from '../../utils/media-static';

export interface UploadImageOptions {
  trim?: boolean;
  removeBg?: boolean;
  /**
   * Carpeta destino: en Cloudinary `products/<code>` por defecto; en modo local
   * es la subcarpeta bajo `db/images_static/uploads`.
   */
  folder?: string;
  /** Lado máximo en px (recorte cuadrado). Útil para avatares. */
  resize?: number;
  /** WebP sin pérdida (por defecto). En fotos conviene desactivarlo. */
  lossless?: boolean;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly storage: 'local' | 'cloudinary';

  constructor(private readonly configService: ConfigService) {
    const configured = (process.env.MEDIA_STORAGE || '').toLowerCase();
    this.storage =
      configured === 'cloudinary' || configured === 'local'
        ? configured
        : process.env.NODE_ENV === 'production'
          ? 'cloudinary'
          : 'local';

    const cloudName = this.configService.get<string>('cloudinary.cloudName');
    const apiKey = this.configService.get<string>('cloudinary.apiKey');
    const apiSecret = this.configService.get<string>('cloudinary.apiSecret');

    if (this.storage === 'cloudinary') {
      if (!cloudName || !apiKey || !apiSecret) {
        this.logger.error('Cloudinary credentials not configured.');
        throw new Error('Cloudinary credentials are required');
      }

      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });

      this.logger.log('Media storage: Cloudinary');
      return;
    }

    this.logger.log(
      `Media storage: local (${resolveMediaStaticRoot()}/images_static/uploads)`,
    );
  }

  /**
   * Procesa la imagen (quitar fondo, recortar, redimensionar y convertir a
   * WebP) y la persiste según `MEDIA_STORAGE`: en disco (por defecto) o en
   * Cloudinary. Devuelve la URL/path que se guarda en la BD.
   */
  async uploadImage(
    file: any,
    productCode: string,
    options?: UploadImageOptions,
  ): Promise<{ url: string; mediaType: string }> {
    try {
      const webpBuffer = await this.toWebp(file, options);

      if (this.storage === 'local') {
        return await this.saveLocal(webpBuffer, productCode, options);
      }

      return await this.uploadToCloudinary(webpBuffer, productCode, options);
    } catch (error) {
      this.logger.error('Error guardando imagen:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Error al subir imagen: ${message}`);
    }
  }

  private async toWebp(
    file: any,
    options?: UploadImageOptions,
  ): Promise<Buffer> {
    let buffer: Buffer = file.buffer;

    // 1. Quitar fondo (removeBg)
    if (options?.removeBg) {
      this.logger.log(`Quitando fondo de: ${file.originalname}`);
      const blob = await removeBackground(buffer, {
        model: 'medium',
        output: { format: 'image/png' },
      });
      buffer = Buffer.from(await blob.arrayBuffer());
      this.logger.log(`Fondo eliminado: ${file.originalname}`);
    }

    // 2. Auto-recortar (trim)
    if (options?.trim) {
      this.logger.log(`Recortando: ${file.originalname}`);
      buffer = await sharp(buffer).trim({ threshold: 10 }).toBuffer();
      this.logger.log(`Imagen recortada: ${file.originalname}`);
    }

    // 3. Reducir si se pide (avatares: 512 px, cuadrado, recorte centrado)
    if (options?.resize) {
      buffer = await sharp(buffer)
        .resize(options.resize, options.resize, { fit: 'cover' })
        .toBuffer();
    }

    // 4. Convertir a WebP
    const webpBuffer = await sharp(buffer)
      .webp({ lossless: options?.lossless ?? true })
      .toBuffer();

    this.logger.log(
      `Imagen convertida a WebP: ${file.originalname} (${file.buffer.length} → ${webpBuffer.length} bytes)`,
    );

    return webpBuffer;
  }

  private async saveLocal(
    buffer: Buffer,
    code: string,
    options?: UploadImageOptions,
  ): Promise<{ url: string; mediaType: string }> {
    const folder =
      sanitizeMediaFolder(options?.folder ?? `products/${code}`) || 'misc';
    const dir = path.join(
      resolveMediaStaticRoot(),
      'images_static',
      'uploads',
      folder,
    );
    await fs.mkdir(dir, { recursive: true });

    const safeCode = sanitizeMediaFolder(String(code)) || 'img';
    const fileName = `${safeCode}_${Date.now()}.webp`;
    await fs.writeFile(path.join(dir, fileName), buffer);

    const url = `/static/media/uploads/${folder}/${fileName}`;
    this.logger.log(`Imagen guardada en disco: ${url}`);
    return { url, mediaType: 'image/webp' };
  }

  private async uploadToCloudinary(
    webpBuffer: Buffer,
    code: string,
    options?: UploadImageOptions,
  ): Promise<{ url: string; mediaType: string }> {
    if (!cloudinary.config().cloud_name) {
      throw new Error('Cloudinary no configurado');
    }

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options?.folder ?? `products/${code}`,
          public_id: `${code}_${Date.now()}`,
          use_filename: true,
          unique_filename: false,
          resource_type: 'image',
          format: 'webp',
          transformation: [{ quality: 'auto:good' }],
        },
        (error, uploaded) => {
          if (error) {
            reject(error);
            return;
          }
          if (!uploaded) {
            reject(new Error('Cloudinary no devolvió un resultado.'));
            return;
          }
          resolve(uploaded);
        },
      );

      const stream = Readable.from(webpBuffer);
      stream.pipe(uploadStream);
    });

    const secureUrl = result.secure_url;
    this.logger.log(`Imagen WebP subida a Cloudinary: ${secureUrl}`);
    return { url: secureUrl, mediaType: 'image/webp' };
  }
}
