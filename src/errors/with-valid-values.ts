import { DataError } from './data-error';
import type { DataOperation } from './data-operation';

/** Runs `build`; a value it cannot write (a bad GUID, a list without an item name) becomes `MJD302`. */
export function withValidValues<R>(operation: DataOperation, build: () => R): R {
  try {
    return build();
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw DataError.create('MJD302', { operation, cause: error }, (error as Error).message);
  }
}
