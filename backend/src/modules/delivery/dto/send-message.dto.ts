import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Mensaje del chat por pedido (repartidor). */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'Escribe un mensaje.' })
  @MaxLength(2000, { message: 'El mensaje no puede superar 2000 caracteres.' })
  body: string;
}
