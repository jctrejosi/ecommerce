import {
  IsArray,
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
