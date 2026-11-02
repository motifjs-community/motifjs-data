export interface ODataBatchOptions {
  /** Default: the service root plus `$batch` (`https://host/odata/$batch`). */
  url?: string;
  /** Sends the changes as one change set: all of them are saved or none. */
  allOrNothing?: boolean;
}
