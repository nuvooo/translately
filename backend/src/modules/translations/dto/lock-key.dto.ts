import { IsBoolean } from 'class-validator'

export class LockKeyDto {
  @IsBoolean()
  locked!: boolean
}
