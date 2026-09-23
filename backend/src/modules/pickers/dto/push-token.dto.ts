import { IsNotEmpty, IsString } from 'class-validator';

/** Token FCM del dispositivo que la app de picking registra al iniciar sesión. */
export class PushTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
