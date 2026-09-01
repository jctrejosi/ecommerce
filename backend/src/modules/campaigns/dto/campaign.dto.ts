import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CampaignMessageDto {
  @IsEnum(['whatsapp', 'email', 'sms'])
  channel: 'whatsapp' | 'email' | 'sms';

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsObject()
  emailBlocks?: Record<string, unknown>;
}

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  productIds?: number[];

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsIn(['multi', 'bundle'])
  mode?: 'multi' | 'bundle';

  @IsOptional()
  @IsArray()
  @IsEnum(['whatsapp', 'email', 'sms'], { each: true })
  channels?: ('whatsapp' | 'email' | 'sms')[];

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsArray()
  @Type(() => CampaignMessageDto)
  messages?: CampaignMessageDto[];
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  productIds?: number[];

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsIn(['multi', 'bundle'])
  mode?: 'multi' | 'bundle';

  @IsOptional()
  @IsArray()
  @IsEnum(['whatsapp', 'email', 'sms'], { each: true })
  channels?: ('whatsapp' | 'email' | 'sms')[];

  @IsOptional()
  @IsEnum(['borrador', 'programada', 'enviando', 'enviada', 'fallida'])
  status?: 'borrador' | 'programada' | 'enviando' | 'enviada' | 'fallida';

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsArray()
  @Type(() => CampaignMessageDto)
  messages?: CampaignMessageDto[];
}

export class GenerateRecipientsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(['whatsapp', 'email', 'sms'], { each: true })
  channels?: ('whatsapp' | 'email' | 'sms')[];

  @IsOptional()
  @IsInt()
  @Min(0)
  segment?: number;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsIn(['multi', 'bundle'])
  mode?: 'multi' | 'bundle';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  manualCedulas?: string[];
}

export class GenerateContentDto {
  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  products?: { id?: number; name?: string; price?: number }[];

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsArray()
  @IsEnum(['whatsapp', 'email', 'sms'], { each: true })
  channels: ('whatsapp' | 'email' | 'sms')[];
}

export class InterpretSegmentDto {
  @IsOptional()
  @IsIn(['multi', 'bundle'])
  mode?: 'multi' | 'bundle';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productNames?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsInt()
  bestSegment?: number;

  @IsOptional()
  @IsArray()
  ranking?: { segment?: number; total?: number; buyers?: number; share?: number }[];

  @IsOptional()
  @IsInt()
  segmentTotal?: number;

  @IsOptional()
  @IsInt()
  total?: number;

  @IsOptional()
  @IsInt()
  buyers?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  bundleFallback?: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsNumber()
  avgPropensity?: number;

  @IsOptional()
  @IsNumber()
  avgUplift?: number;
}

export class ScoreClientsFiltersDto {
  @IsOptional()
  @IsInt()
  segment?: number;

  @IsOptional()
  @IsNumber()
  minFrecuencia?: number;

  @IsOptional()
  @IsNumber()
  maxFrecuencia?: number;

  @IsOptional()
  @IsNumber()
  minMonetario?: number;

  @IsOptional()
  @IsNumber()
  maxMonetario?: number;

  @IsOptional()
  @IsNumber()
  minTicketPromedio?: number;

  @IsOptional()
  @IsNumber()
  maxTicketPromedio?: number;

  @IsOptional()
  @IsNumber()
  minCategoriasDistintas?: number;

  @IsOptional()
  @IsNumber()
  maxCategoriasDistintas?: number;
}

export class ScoreClientsDto {
  @IsOptional()
  @IsObject()
  @Type(() => ScoreClientsFiltersDto)
  filters?: ScoreClientsFiltersDto;

  @IsOptional()
  @IsNumber()
  minPropensity?: number;

  @IsOptional()
  @IsIn(['propensity', 'uplift', 'segment', 'cedula'])
  sort?: 'propensity' | 'uplift' | 'segment' | 'cedula';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AddManualRecipientsDto {
  @IsArray()
  @IsString({ each: true })
  cedulas: string[];
}
