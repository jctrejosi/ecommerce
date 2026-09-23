import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { DrizzleService } from '../../database/drizzle.service';
import { customers } from '../../../drizzle/schema';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const fcmEndpoint = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

/**
 * Envía notificaciones push (FCM HTTP v1) al dispositivo del cliente.
 *
 * Se configura con la cuenta de servicio de Firebase en la variable de entorno
 * `FIREBASE_SERVICE_ACCOUNT_JSON` (el JSON completo, o su base64 para evitar
 * problemas con saltos de línea). Si no está configurada, el servicio queda
 * **inactivo**: las notificaciones in-app y el WebSocket siguen igual; solo no
 * se manda el push.
 *
 * No usa `firebase-admin`: firma un JWT (RS256) con `jsonwebtoken` y cambia ese
 * JWT por un access token de Google, como pide la API HTTP v1.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private account: ServiceAccount | null = null;
  private accessToken: string | null = null;
  private accessTokenExp = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly drizzle: DrizzleService,
  ) {}

  onModuleInit() {
    const raw = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!raw) {
      this.logger.log(
        'Push desactivado: falta FIREBASE_SERVICE_ACCOUNT_JSON (solo notificaciones in-app).',
      );
      return;
    }

    try {
      const parsed = JSON.parse(
        raw.trim().startsWith('{')
          ? raw
          : Buffer.from(raw, 'base64').toString('utf8'),
      ) as ServiceAccount;

      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        throw new Error('faltan project_id, client_email o private_key');
      }
      // En el JSON la clave viene con "\n" escapados.
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');

      this.account = parsed;
      this.logger.log(`Push FCM configurado (proyecto ${parsed.project_id})`);
    } catch (err) {
      this.logger.error(
        `Cuenta de servicio inválida: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Access token de Google (se cachea ~1 h). */
  private async getAccessToken(): Promise<string> {
    if (!this.account) throw new Error('sin cuenta de servicio');

    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessTokenExp - 60 > now) {
      return this.accessToken;
    }

    const assertion = jwt.sign(
      {
        iss: this.account.client_email,
        scope: FCM_SCOPE,
        aud: TOKEN_URL,
      },
      this.account.private_key,
      { algorithm: 'RS256', expiresIn: '1h' },
    );

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      throw new Error(data.error ?? `token HTTP ${res.status}`);
    }

    this.accessToken = data.access_token;
    this.accessTokenExp = now + (data.expires_in ?? 3600);
    return this.accessToken;
  }

  /**
   * Manda un push al cliente si tiene token registrado. No lanza: el push es un
   * extra y nunca debe tumbar el flujo de la notificación in-app.
   */
  async sendToCustomer(
    customerId: number,
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    if (!this.account) return;

    let token: string | null | undefined;
    try {
      const [row] = await this.drizzle.db
        .select({ token: customers.pushToken })
        .from(customers)
        .where(eq(customers.id, BigInt(customerId)))
        .limit(1);
      token = row?.token;
    } catch (err) {
      this.logger.warn(
        `No se pudo leer el token push del cliente ${customerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (!token) return;

    try {
      const accessToken = await this.getAccessToken();
      const res = await fetch(fcmEndpoint(this.account.project_id), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data ?? {},
            android: {
              priority: 'high',
              notification: { channelId: 'mercaldas', sound: 'default' },
            },
          },
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { status?: string; message?: string };
        };
        const status = err?.error?.status;
        // Token caducado/inexistente: se limpia para no reintentar siempre.
        // (No se limpia en INVALID_ARGUMENT: puede ser un error del payload.)
        if (status === 'UNREGISTERED' || status === 'NOT_FOUND') {
          await this.clearToken(customerId);
        }
        this.logger.warn(
          `Push al cliente ${customerId} falló (${status ?? res.status}): ${err?.error?.message ?? ''}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Push al cliente ${customerId} falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async clearToken(customerId: number) {
    try {
      await this.drizzle.db
        .update(customers)
        .set({ pushToken: null })
        .where(eq(customers.id, BigInt(customerId)));
    } catch {
      /* best-effort */
    }
  }
}
