import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DeliveryLoginDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  password!: string;
}
