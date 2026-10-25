import { BadRequestException, PipeTransform } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

/** Rejects anything that is not a 24-hex-character ObjectId before it can reach the database. */
export class ParseObjectIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{24}$/.test(value) || !isValidObjectId(value)) {
      throw new BadRequestException('Invalid id');
    }
    return value.toLowerCase();
  }
}
