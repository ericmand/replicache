import type * as db from './db/mod';

/**
 * Options for [[ReadTransaction.scan|scan]]
 */
export type ScanOptions = ScanIndexOptions | ScanNoIndexOptions;

/**
 * Options for [[ReadTransaction.scan|scan]] when scanning over the entire key
 * space.
 */
export type ScanNoIndexOptions = {
  /** Only include keys starting with `prefix`. */
  prefix?: string;

  /** Only include up to `limit` results. */
  limit?: number;

  /** When provided the scan starts at this key. */
  start?: {
    key: string;

    /** Whether the `key` is exclusive or inclusive. */
    exclusive?: boolean;
  };
};

/**
 * Options for [[ReadTransaction.scan|scan]] when scanning over an index. When
 * scanning over and index you need to provide the `indexName` and the `start`
 * `key` is now a tuple consisting of secondar and primary key
 */
export type ScanIndexOptions = {
  /** Only include results starting with the *secondary* keys starting with `prefix`. */
  prefix?: string;

  /** Only include up to `limit` results. */
  limit?: number;

  /** Do a [[ReadTransaction.scan|scan]] over a named index. The `indexName`
   * is the name of an index previously created with [[createIndex]]. */
  indexName: string;

  /** When provided the scan starts at this key. */
  start?: {
    key: ScanOptionIndexedStartKey;

    /** Whether the `key` is exclusive or inclusive. */
    exclusive?: boolean;
  };
};

/**
 * If the options contains an `indexName` then the key type is a tuple of
 * secondary and primary.
 */
export type KeyTypeForScanOptions<O extends ScanOptions> = O extends {
  indexName: string;
}
  ? [secondary: string, primary: string]
  : string;

/**
 * The key to start scanning at.
 *
 * If you are scanning the primary index (i.e., you did not specify
 * `indexName`), then pass a single string for this field, which is the key in
 * the primary index to scan at.
 *
 * If you are scanning a secondary index (i.e., you specified `indexName`), then
 * use the tuple form. In that case, `secondary` is the secondary key to start
 * scanning at, and `primary` (if any) is the primary key to start scanning at.
 */

export type ScanOptionIndexedStartKey =
  | [secondary: string, primary?: string]
  | string;

export function toDbScanOptions(options?: ScanOptions): db.ScanOptions {
  if (!options) {
    return {};
  }
  let key: string | ScanOptionIndexedStartKey | undefined;
  let exclusive: boolean | undefined;
  let primary: string | undefined;
  let secondary: string | undefined;
  type MaybeIndexName = {indexName?: string};
  if (options.start) {
    ({key, exclusive} = options.start);
    if ((options as MaybeIndexName).indexName) {
      if (typeof key === 'string') {
        secondary = key;
      } else {
        secondary = key[0];
        primary = key[1];
      }
    } else {
      primary = key as string;
    }
  }

  return {
    prefix: options.prefix,
    startSecondaryKey: secondary,
    startKey: primary,
    startExclusive: exclusive,
    limit: options.limit,
    indexName: (options as MaybeIndexName).indexName,
  };
}
